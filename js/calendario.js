import { Store } from './storage.js';
import { openModal, closeModal, confirmDialog, toast } from './ui.js';
import { icon, escapeHtml } from './utils.js';

const OWN_AREA = 'DST';
const AREAS = [['DST','DST'],['ADG','ADG'],['TI','OTI'],['RRHH','RR. HH.'],['SOPORTE','Soporte']];
const MEETING_TYPES = ['Revisión de seguridad','Auditoría','Gestión de incidentes','Coordinación con otra área','Capacitación','Otro'];
const EXTERNAL_KINDS = [['cliente','Cliente'],['postulante','Postulante'],['proveedor','Proveedor'],['consultor','Consultor'],['otro','Otro']];
const STATUS_LABEL = { scheduled:'Programada', confirmed:'Confirmada', in_progress:'En curso', completed:'Finalizada', cancelled:'Cancelada' };
const MODALITY_LABEL = { presencial: 'Presencial', virtual: 'Virtual' };

/* Ícono clickeable que resume la modalidad de la reunión: en presencial
   abre la dirección en Google Maps, en virtual abre el link de ingreso
   tal cual se guardó. Sin ubicación cargada, solo informa la modalidad. */
function modalityIconHtml(m) {
  const isVirtual = m.modality === 'virtual';
  const iconName = isVirtual ? 'video' : 'map-pin';
  const label = MODALITY_LABEL[m.modality] || 'Presencial';
  if (!m.location) {
    return `<span class="tag" title="${escapeHtml(label)}">${icon(iconName)} ${label}</span>`;
  }
  const href = isVirtual
    ? (/^https?:\/\//i.test(m.location) ? m.location : 'https://' + m.location)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.location)}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="tag" style="text-decoration:none;cursor:pointer" title="${escapeHtml(label + ' · ' + m.location)}" onclick="event.stopPropagation()">${icon(iconName)} ${label}</a>`;
}

let _mode = 'area';               // 'area' | 'mine' | 'week' | 'weekArea'
let _filters = { area: OWN_AREA, participant: '', type: '', date_from: todayISO(), date_to: '', status: '' };
let _meetings = [];
let _editingId = null;
let _conflicts = [];
let _selectedParticipants = [];
let _externalParticipants = [];
let _dirResults = [];
let _dirDebounce, _filterDebounce;
let _checkToken = 0;
let _pendingImage = null;         // url subida en el modal, antes de guardar la reunión
let _weekOffset = 0;              // semanas respecto a la actual, para la vista semanal
const WEEK_START_HOUR = 7;
const WEEK_END_HOUR = 21;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDateOnly(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function fullName(p) { return [p.nombre, p.apellidos].filter(Boolean).join(' '); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('dst_user')); } catch { return null; }
}
function isPrivileged() { return (getUser()?.nivel_acceso || 0) >= 100; }

function isoDate(d) { return d.toISOString().slice(0, 10); }
function weekBounds(offset) {
  const now = new Date();
  const day = now.getDay(); // 0=domingo..6=sábado
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() + diffToMonday + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  return { monday, sunday: days[6], days };
}
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_LABELS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export function renderCalendario() {
  const container = document.getElementById('view-calendario');
  container.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>Cargando calendario…</p></div></div>`;
  load();
}

async function load() {
  try {
    let params;
    if (_mode === 'week' || _mode === 'weekArea') {
      const { monday, sunday } = weekBounds(_weekOffset);
      params = { date_from: isoDate(monday), date_to: isoDate(sunday) };
      if (_mode === 'week') {
        /* Solo las reuniones propias de quien está logueado — el horario
           de una misma persona nunca se solapa (ya se valida al crear/
           editar), así que esta vista nunca va a mostrar bloques
           superpuestos. */
        params.mine = 'true';
      } else {
        /* Vista semana general: todas las reuniones del área, de
           cualquier participante — estas sí pueden solaparse entre sí
           (dos personas distintas con reuniones a la misma hora), así
           que el render usa un layout de columnas para no superponerlas. */
        params.area = OWN_AREA;
      }
    } else {
      params = { date_from: _filters.date_from || undefined, date_to: _filters.date_to || undefined, status: _filters.status || undefined };
      if (_mode === 'mine') {
        params.mine = 'true';
      } else {
        params.area = _filters.area;
      }
    }
    let meetings = await Store.getMeetings(params);
    if (_mode !== 'week' && _mode !== 'weekArea') {
      if (_filters.participant) {
        const q = _filters.participant.toLowerCase();
        meetings = meetings.filter(m => (m.participants || []).some(p =>
          (p.user_name || p.external_name || '').toLowerCase().includes(q)));
      }
      if (_filters.type) {
        meetings = meetings.filter(m => (m.meeting_type || '').toLowerCase() === _filters.type.toLowerCase());
      }
    }
    _meetings = meetings;
    renderPage();
  } catch (err) {
    const c = document.getElementById('view-calendario');
    if (c) c.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>${escapeHtml(err.message || 'Error al cargar el calendario')}</p></div></div>`;
  }
}

function renderPage() {
  const c = document.getElementById('view-calendario');
  if (!c) return;

  c.innerHTML = `
    <div style="position:sticky;top:0;z-index:30;background:var(--bg,#f6f7f9);padding-top:4px;padding-bottom:10px;margin:0 -2px;">
      <div class="toolbar">
        <div class="cal-tabs">
          <button type="button" class="cal-tab ${_mode==='area' ? 'active' : ''}" data-mode="area">Calendario — DST</button>
          <button type="button" class="cal-tab ${_mode==='mine' ? 'active' : ''}" data-mode="mine">Mi agenda</button>
          <button type="button" class="cal-tab ${_mode==='week' ? 'active' : ''}" data-mode="week">Vista semana</button>
          <button type="button" class="cal-tab ${_mode==='weekArea' ? 'active' : ''}" data-mode="weekArea">Vista semana general</button>
        </div>
        <button class="btn btn-primary" id="cal-add-btn">${icon('plus')} Agregar reunión</button>
      </div>
      ${(_mode === 'week' || _mode === 'weekArea') ? '' : `
      <div class="toolbar" style="margin-top:10px;">
        <div class="toolbar__filters" style="flex-wrap:wrap;">
          ${_mode === 'area' ? `
          <select id="f-area">
            ${AREAS.map(([k,l]) => `<option value="${k}" ${_filters.area===k?'selected':''}>${l}</option>`).join('')}
            ${isPrivileged() ? `<option value="ALL" ${_filters.area==='ALL'?'selected':''}>Todas las áreas</option>` : ''}
          </select>` : ''}
          <div class="search-box">
            ${icon('search')}
            <input id="f-participant" placeholder="Buscar participante..." value="${escapeHtml(_filters.participant)}">
          </div>
          <select id="f-type">
            <option value="">Todos los tipos</option>
            ${MEETING_TYPES.map(t => `<option value="${t}" ${_filters.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
          <input type="date" id="f-date-from" value="${_filters.date_from}">
          <input type="date" id="f-date-to" value="${_filters.date_to}">
          <select id="f-status">
            <option value="">Todos los estados</option>
            ${Object.entries(STATUS_LABEL).map(([k,l]) => `<option value="${k}" ${_filters.status===k?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>`}
    </div>
    ${_mode === 'week' ? weekViewHtml(false) : _mode === 'weekArea' ? weekViewHtml(true) : `
    <div id="cal-list" style="margin-top:16px;">${listHtml()}</div>`}
  `;
  wirePage();
}

/* En la vista semana solo se muestran las reuniones propias (ver
   load()), así que colorear por área no sirve para distinguirlas —
   casi siempre serían todas del mismo color. Se colorea por tipo de
   reunión en su lugar, que varía más seguido. */
const MEETING_TYPE_COLORS = {
  'Revisión de seguridad': '#0ea5e9',
  'Auditoría': '#6366f1',
  'Gestión de incidentes': '#f43f5e',
  'Coordinación con otra área': '#8b5cf6',
  'Capacitación': '#10b981',
  'Otro': '#64748b',
};
function meetingTypeColor(type) { return MEETING_TYPE_COLORS[type] || '#64748b'; }

const WEEK_ROW_H = 48; // px por hora

/* Reparte eventos que se solapan en el tiempo en columnas lado a lado
   (como Google Calendar), para que nunca se dibujen uno encima del
   otro. Agrupa eventos en "racimos" de solapamiento consecutivo y
   dentro de cada racimo asigna la primera columna libre a cada evento
   (algoritmo greedy por orden de inicio). */
function layoutDayEvents(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (!cluster.length) return;
    const colEnds = [];
    cluster.forEach(ev => {
      let col = colEnds.findIndex(end => end <= ev.startMin);
      if (col === -1) { col = colEnds.length; colEnds.push(ev.endMin); }
      else { colEnds[col] = ev.endMin; }
      placed.push({ ev, col });
    });
    const totalCols = colEnds.length;
    placed.slice(-cluster.length).forEach(p => { p.totalCols = totalCols; });
    cluster = []; clusterEnd = -Infinity;
  };

  sorted.forEach(ev => {
    if (cluster.length && ev.startMin >= clusterEnd) flushCluster();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  });
  flushCluster();

  return placed;
}

function weekViewHtml(general) {
  const { monday, days } = weekBounds(_weekOffset);
  const hours = [];
  for (let h = WEEK_START_HOUR; h < WEEK_END_HOUR; h++) hours.push(h);
  const rangeLabel = `${monday.getDate()} de ${MONTH_LABELS[monday.getMonth()]}${monday.getMonth() !== days[6].getMonth() ? ' – ' + days[6].getDate() + ' de ' + MONTH_LABELS[days[6].getMonth()] : ' – ' + days[6].getDate()} de ${days[6].getFullYear()}`;
  const todayIso = todayISO();

  const dayCols = days.map((d) => {
    const iso = isoDate(d);
    const isToday = iso === todayIso;
    const dayMeetings = _meetings
      .filter(m => m.meeting_date === iso && m.visibility !== 'busy_only')
      .map(m => {
        const [sh, sm] = m.start_time.slice(0,5).split(':').map(Number);
        const [eh, em] = m.end_time.slice(0,5).split(':').map(Number);
        return {
          m,
          startMin: Math.max(0, (sh - WEEK_START_HOUR) * 60 + sm),
          endMin: Math.min((WEEK_END_HOUR - WEEK_START_HOUR) * 60, (eh - WEEK_START_HOUR) * 60 + em),
        };
      });
    const blocks = layoutDayEvents(dayMeetings).map(({ ev, col, totalCols }) => {
      const { m, startMin, endMin } = ev;
      const top = (startMin / 60) * WEEK_ROW_H;
      const height = Math.max(20, ((endMin - startMin) / 60) * WEEK_ROW_H);
      const widthPct = 100 / totalCols;
      const leftPct = col * widthPct;
      const posStyle = totalCols > 1
        ? `left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px)`
        : 'left:2px;right:2px';
      const internalNames = general
        ? (m.participants || []).filter(p => p.participant_type === 'internal').map(p => p.user_name).filter(Boolean)
        : [];
      return `
        <button type="button" class="cal-week-event" data-id="${m.id}" style="position:absolute;border:0;border-radius:6px;background:${meetingTypeColor(m.meeting_type)};color:#fff;text-align:left;padding:3px 6px;overflow:hidden;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.15);top:${top}px;height:${height}px;${posStyle}">
          <div style="font-size:10px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.title)}</div>
          <div style="font-size:9px;opacity:.9;line-height:1.2">${m.start_time.slice(0,5)}–${m.end_time.slice(0,5)}</div>
          ${internalNames.length ? `<div style="font-size:9px;opacity:.85;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(internalNames.join(', '))}</div>` : ''}
        </button>`;
    }).join('');
    return `
      <div style="position:relative;border-left:1px solid var(--border);${isToday ? 'background:rgba(99,102,241,.05)' : ''}height:${hours.length * WEEK_ROW_H}px">
        ${hours.map((_, hi) => `<div style="position:absolute;left:0;right:0;border-top:1px solid var(--border);top:${hi * WEEK_ROW_H}px"></div>`).join('')}
        ${blocks}
      </div>`;
  }).join('');

  const dayHeaders = days.map((d, i) => {
    const iso = isoDate(d);
    const isToday = iso === todayIso;
    return `
      <div style="text-align:center;padding:8px 0;border-left:1px solid var(--border);${isToday ? 'background:rgba(99,102,241,.05)' : ''}">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">${WEEKDAY_LABELS[i]}</div>
        <div style="font-size:13.5px;font-weight:700;${isToday ? 'color:var(--primary)' : ''}">${d.getDate()}</div>
      </div>`;
  }).join('');

  return `
  <div class="card" style="padding:0;overflow:hidden;margin-top:16px;">
    ${general ? `<div style="padding:10px 14px 0;font-size:12px;font-weight:600;color:var(--text-muted);">Todas las reuniones del área DST — eventos que se cruzan en horario se muestran lado a lado</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);">
      <button type="button" id="week-today-btn" class="btn btn-secondary" style="padding:6px 12px;font-size:12.5px;">Hoy</button>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" id="week-prev-btn" style="border:0;background:none;cursor:pointer;color:var(--text-muted);padding:4px;">${icon('chevron-left')}</button>
        <span style="font-size:13.5px;font-weight:600;">${rangeLabel}</span>
        <button type="button" id="week-next-btn" style="border:0;background:none;cursor:pointer;color:var(--text-muted);padding:4px;">${icon('chevron-right')}</button>
      </div>
      <div style="width:72px;"></div>
    </div>
    <div style="overflow-x:auto;">
      <div style="display:grid;grid-template-columns:56px repeat(7,minmax(110px,1fr));min-width:820px">
        <div></div>${dayHeaders}
        <div style="position:relative;height:${hours.length * WEEK_ROW_H}px">
          ${hours.map((h, hi) => `<div style="position:absolute;left:0;right:0;text-align:right;padding-right:8px;font-size:11px;color:var(--text-muted);transform:translateY(-50%);top:${hi * WEEK_ROW_H}px">${String(h).padStart(2,'0')}:00</div>`).join('')}
        </div>
        ${dayCols}
      </div>
    </div>
  </div>`;
}

function listHtml() {
  if (!_meetings.length) return `<div class="table-wrap"><div class="empty-state">${icon('calendar')}<p><strong>No hay reuniones en este rango</strong></p></div></div>`;
  const groups = {};
  _meetings.forEach(m => { (groups[m.meeting_date] ||= []).push(m); });
  return Object.entries(groups).map(([date, items]) => `
    <div style="margin-bottom:20px;">
      <h4 style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">${fmtDateOnly(date)}</h4>
      <div style="display:flex;flex-direction:column;gap:8px;">${items.map(meetingCard).join('')}</div>
    </div>`).join('');
}

function meetingCard(m) {
  const isBusy = m.visibility === 'busy_only';
  const participantsHtml = (m.participants || []).map(p => p.participant_type === 'external'
    ? `${escapeHtml(p.external_name)} (${EXTERNAL_KINDS.find(k=>k[0]===p.external_kind)?.[1] || p.external_kind})`
    : `${escapeHtml(p.user_name || '—')}${p.user_area ? ' — ' + escapeHtml(p.user_area) : ''}${p.user_cargo ? ' — ' + escapeHtml(p.user_cargo) : ''}`)
    .join('<br>');
  const statusTag = m.status === 'cancelled' ? 'Cancelada' : m.status === 'completed' ? 'Finalizada' : 'Programada';

  return `
  <div class="card" style="padding:14px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong>${escapeHtml(m.title)}</strong>
          <span class="tag">${escapeHtml(m.area)}</span>
          <span class="tag">${statusTag}</span>
          ${modalityIconHtml(m)}
          ${isBusy ? `<span class="tag">${icon('lock')} Privada</span>` : ''}
        </div>
        <p class="cell-sub" style="margin-top:4px;">${m.start_time.slice(0,5)} — ${m.end_time.slice(0,5)}${m.meeting_type ? ' · ' + escapeHtml(m.meeting_type) : ''}</p>
        ${!isBusy && m.motivo ? `<p style="font-size:13.5px;margin-top:6px;">${escapeHtml(m.motivo)}</p>` : ''}
        ${!isBusy && participantsHtml ? `<div class="cell-sub" style="margin-top:6px;">${participantsHtml}</div>` : ''}
        ${isBusy ? '<p class="cell-sub" style="margin-top:6px;">Sin acceso al detalle de esta reunión</p>' : ''}
      </div>
      ${!isBusy ? `
      <div style="display:flex;gap:4px;flex-shrink:0;">
        <button type="button" class="btn btn-ghost btn-sm cal-view-btn" data-id="${m.id}" title="Ver detalle">${icon('eye')}</button>
        <button type="button" class="btn btn-ghost btn-sm cal-edit-btn" data-id="${m.id}" title="Editar">${icon('edit')}</button>
        <button type="button" class="btn btn-ghost btn-sm cal-cancel-btn" data-id="${m.id}" title="Cancelar">${icon('alert-triangle')}</button>
        <button type="button" class="btn btn-ghost btn-sm cal-del-btn" data-id="${m.id}" title="Eliminar">${icon('trash')}</button>
      </div>` : ''}
    </div>
  </div>`;
}

function wirePage() {
  document.querySelectorAll('.cal-tab').forEach(btn => btn.addEventListener('click', () => {
    _mode = btn.dataset.mode;
    if (_mode === 'week' || _mode === 'weekArea') _weekOffset = 0;
    load();
  }));

  const weekPrev = document.getElementById('week-prev-btn');
  if (weekPrev) weekPrev.addEventListener('click', () => { _weekOffset--; load(); });
  const weekNext = document.getElementById('week-next-btn');
  if (weekNext) weekNext.addEventListener('click', () => { _weekOffset++; load(); });
  const weekToday = document.getElementById('week-today-btn');
  if (weekToday) weekToday.addEventListener('click', () => { _weekOffset = 0; load(); });
  document.querySelectorAll('.cal-week-event').forEach(btn => btn.addEventListener('click', () => viewMeeting(btn.dataset.id)));

  const areaSel = document.getElementById('f-area');
  if (areaSel) areaSel.addEventListener('change', e => { _filters.area = e.target.value; load(); });
  const partInput = document.getElementById('f-participant');
  if (partInput) partInput.addEventListener('input', e => {
    clearTimeout(_filterDebounce);
    _filterDebounce = setTimeout(() => { _filters.participant = e.target.value; load(); }, 300);
  });
  const typeSel = document.getElementById('f-type');
  if (typeSel) typeSel.addEventListener('change', e => { _filters.type = e.target.value; load(); });
  const dateFrom = document.getElementById('f-date-from');
  if (dateFrom) dateFrom.addEventListener('change', e => { _filters.date_from = e.target.value; load(); });
  const dateTo = document.getElementById('f-date-to');
  if (dateTo) dateTo.addEventListener('change', e => { _filters.date_to = e.target.value; load(); });
  const statusSel = document.getElementById('f-status');
  if (statusSel) statusSel.addEventListener('change', e => { _filters.status = e.target.value; load(); });

  const addBtn = document.getElementById('cal-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openForm());

  document.querySelectorAll('.cal-view-btn').forEach(btn => btn.addEventListener('click', () => viewMeeting(btn.dataset.id)));
  document.querySelectorAll('.cal-edit-btn').forEach(btn => btn.addEventListener('click', () => openForm(btn.dataset.id)));
  document.querySelectorAll('.cal-cancel-btn').forEach(btn => btn.addEventListener('click', () => cancelMeeting(btn.dataset.id)));
  document.querySelectorAll('.cal-del-btn').forEach(btn => btn.addEventListener('click', () => deleteMeeting(btn.dataset.id)));
}

function formFieldsHtml(editing) {
  const currentImage = _pendingImage !== null ? _pendingImage : (editing?.image_url || null);
  return `
      <form id="meeting-form">
        <div class="field">
          <label>Nombre de la reunión *</label>
          <input name="title" required autocomplete="off" value="${escapeHtml(editing?.title || '')}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="field"><label>Fecha *</label><input type="date" name="date" required value="${editing?.meeting_date || ''}"></div>
          <div class="field"><label>Inicio *</label><input type="time" name="start_time" required value="${editing ? editing.start_time.slice(0,5) : ''}"></div>
          <div class="field"><label>Fin *</label><input type="time" name="end_time" required value="${editing ? editing.end_time.slice(0,5) : ''}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field">
            <label>Tipo de reunión</label>
            <select name="meeting_type">
              <option value="">— Seleccionar —</option>
              ${MEETING_TYPES.map(t => `<option value="${t}" ${editing?.meeting_type===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Modalidad</label>
            <select name="modality">
              <option value="presencial" ${(editing?.modality || 'presencial')==='presencial'?'selected':''}>Presencial</option>
              <option value="virtual" ${editing?.modality==='virtual'?'selected':''}>Virtual</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Motivo</label><input name="motivo" autocomplete="off" value="${escapeHtml(editing?.motivo || '')}"></div>
        <div class="field"><label>Descripción</label><textarea name="description" rows="2">${escapeHtml(editing?.description || '')}</textarea></div>
        <div class="field">
          <label id="cal-location-label">${(editing?.modality || 'presencial')==='virtual' ? 'Link de la reunión' : 'Dirección'}</label>
          <input name="location" id="cal-location-input" placeholder="${(editing?.modality || 'presencial')==='virtual' ? 'Link de Zoom, Meet, Teams...' : 'Sala de reuniones, dirección...'}" autocomplete="off" value="${escapeHtml(editing?.location || '')}">
        </div>
        <div class="field">
          <label>Imagen del evento (opcional)</label>
          ${currentImage ? `
            <div style="position:relative;display:inline-block;margin-bottom:6px;">
              <img src="${escapeHtml(currentImage)}" style="border-radius:8px;max-height:110px;border:1px solid var(--border);display:block;">
              <button type="button" id="cal-image-remove" style="position:absolute;top:-6px;right:-6px;background:#fff;border-radius:50%;border:1px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,.2);width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);">${icon('close')}</button>
            </div>` : ''}
          <input type="file" id="cal-image-input" accept="image/*" style="font-size:12.5px;">
          <p id="cal-image-status" class="cell-sub" style="margin-top:4px;"></p>
        </div>
        <div class="field">
          <label>Participantes internos</label>
          <div style="position:relative;">
            <input id="cal-participant-search" placeholder="Buscar por nombre, cargo o área..." autocomplete="off">
            <div id="cal-dir-results" style="display:none;position:absolute;z-index:10;left:0;right:0;background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);margin-top:4px;max-height:180px;overflow-y:auto;"></div>
          </div>
          <div id="cal-selected-participants" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${selectedParticipantsHtml()}</div>
        </div>
        <div class="field">
          <label>Participante externo (cliente, postulante, proveedor...)</label>
          <div style="display:flex;gap:8px;">
            <input id="cal-ext-name" placeholder="Nombre" autocomplete="off" style="flex:1;">
            <select id="cal-ext-kind" style="width:auto;">${EXTERNAL_KINDS.map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}</select>
            <button type="button" class="btn btn-secondary" id="cal-ext-add">${icon('plus')}</button>
          </div>
          <div id="cal-selected-externals" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${selectedExternalsHtml()}</div>
        </div>
        <div id="cal-conflict-banner"></div>
      </form>
    `;
}

function openForm(editId) {
  const editing = editId ? _meetings.find(m => m.id === editId) : null;
  if (editId && (!editing || editing.visibility === 'busy_only')) return;
  _editingId = editId || null;
  _conflicts = [];
  _pendingImage = null;
  if (editing) {
    _selectedParticipants = (editing.participants || []).filter(p => p.participant_type === 'internal')
      .map(p => ({ user_id: p.user_id, nombre: p.user_name, area: p.user_area }));
    _externalParticipants = (editing.participants || []).filter(p => p.participant_type === 'external')
      .map(p => ({ name: p.external_name, kind: p.external_kind }));
  } else {
    _selectedParticipants = [];
    _externalParticipants = [];
  }

  const modal = openModal({
    title: editing ? 'Editar reunión' : 'Nueva reunión',
    size: 'lg',
    bodyHtml: formFieldsHtml(editing),
    footerHtml: `
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn btn-primary" id="cal-save-btn" ${_conflicts.length ? 'disabled' : ''}>${editing ? 'Guardar cambios' : 'Guardar reunión'}</button>
    `,
  });

  wireFormExtras(modal);
  wireImageControls(modal);
  const form = modal.querySelector('#meeting-form');
  ['date', 'start_time', 'end_time', 'modality'].forEach(name => {
    const el = form.elements[name];
    if (el) el.addEventListener('change', () => liveCheck(modal));
  });
  if (form.elements.modality) form.elements.modality.addEventListener('change', () => updateLocationField(modal));
  modal.querySelector('#cal-save-btn').addEventListener('click', () => submitForm(modal));
}

/* Cambia la etiqueta y el placeholder de Ubicación según la modalidad
   elegida: Dirección (presencial) o Link de la reunión (virtual). */
function updateLocationField(modal) {
  const form = modal.querySelector('#meeting-form');
  const isVirtual = form.elements.modality?.value === 'virtual';
  const label = modal.querySelector('#cal-location-label');
  const input = modal.querySelector('#cal-location-input');
  if (label) label.textContent = isVirtual ? 'Link de la reunión' : 'Dirección';
  if (input) input.placeholder = isVirtual ? 'Link de Zoom, Meet, Teams...' : 'Sala de reuniones, dirección...';
}

/* Vuelve a pintar solo el cuerpo del modal (p. ej. tras subir o quitar
   la imagen), sin cerrar y reabrir el modal entero — así no se pierde
   el resto de lo que ya se había tecleado en el formulario. */
function rerenderFormBody(modal) {
  const editing = _editingId ? _meetings.find(m => m.id === _editingId) : null;
  const body = modal.querySelector('.modal__body');
  if (!body) return;
  body.innerHTML = formFieldsHtml(editing);
  wireFormExtras(modal);
  wireImageControls(modal);
  const form = modal.querySelector('#meeting-form');
  ['date', 'start_time', 'end_time', 'modality'].forEach(name => {
    const el = form.elements[name];
    if (el) el.addEventListener('change', () => liveCheck(modal));
  });
  if (form.elements.modality) form.elements.modality.addEventListener('change', () => updateLocationField(modal));
}

function wireImageControls(modal) {
  const imageInput = modal.querySelector('#cal-image-input');
  if (imageInput) imageInput.addEventListener('change', (e) => handleImageUpload(e, modal));
  const imageRemove = modal.querySelector('#cal-image-remove');
  if (imageRemove) imageRemove.addEventListener('click', () => {
    _pendingImage = null;
    rerenderFormBody(modal);
  });
}

async function handleImageUpload(e, modal) {
  const file = e.target.files[0];
  if (!file) return;
  const status = modal.querySelector('#cal-image-status');
  if (status) status.textContent = 'Subiendo imagen...';
  try {
    const url = await Store.uploadMeetingImage(file);
    _pendingImage = url;
    rerenderFormBody(modal);
    toast('Imagen subida', 'success');
  } catch (err) {
    if (status) status.textContent = '';
    toast(err.message || 'No se pudo subir la imagen', 'error');
  }
}

function selectedParticipantsHtml() {
  if (!_selectedParticipants.length) return '<p class="cell-sub">Sin participantes internos</p>';
  return _selectedParticipants.map(p => `
    <span class="tag" style="display:inline-flex;align-items:center;gap:4px;">
      ${escapeHtml(fullName(p))}${p.area ? ' — ' + escapeHtml(p.area) : ''}
      <button type="button" class="cal-remove-participant" data-id="${p.user_id}" style="border:0;background:none;cursor:pointer;color:inherit;">${icon('close')}</button>
    </span>`).join('');
}
function selectedExternalsHtml() {
  if (!_externalParticipants.length) return '';
  return _externalParticipants.map((p, i) => `
    <span class="tag" style="display:inline-flex;align-items:center;gap:4px;">
      ${escapeHtml(p.name)} (${EXTERNAL_KINDS.find(k=>k[0]===p.kind)?.[1] || p.kind})
      <button type="button" class="cal-remove-external" data-i="${i}" style="border:0;background:none;cursor:pointer;color:inherit;">${icon('close')}</button>
    </span>`).join('');
}
function conflictBannerHtml() {
  if (!_conflicts.length) return '';
  const hard = _conflicts.filter(c => c.hard);
  const soft = _conflicts.filter(c => !c.hard);
  const listItem = c => `<li>${escapeHtml(c.user_name || 'Alguien')} (${escapeHtml(c.area || '—')}) ya tiene "${escapeHtml(c.meeting_name)}" de ${c.start_time.slice(0,5)} a ${c.end_time.slice(0,5)} (${fmtDateOnly(c.date)}).</li>`;
  let html = '';
  if (hard.length) {
    html += `
    <div style="border-radius:8px;background:#fef2f2;border:1px solid #fecaca;padding:12px;font-size:13px;color:#b91c1c;margin-top:8px;">
      <p style="font-weight:600;display:flex;align-items:center;gap:6px;">${icon('alert-triangle')} ${hard.length > 1 ? 'Se encontraron ' + hard.length + ' conflictos de horario:' : 'Conflicto de horario'}</p>
      <ul style="margin:6px 0 0 18px;padding:0;">${hard.map(listItem).join('')}</ul>
    </div>`;
  }
  if (soft.length) {
    html += `
    <div style="border-radius:8px;background:#fffbeb;border:1px solid #fde68a;padding:12px;font-size:13px;color:#92400e;margin-top:8px;">
      <p style="font-weight:600;display:flex;align-items:center;gap:6px;">${icon('alert-triangle')} Hay un cruce de horario (modalidad mixta)</p>
      <ul style="margin:6px 0 0 18px;padding:0;">${soft.map(listItem).join('')}</ul>
      <p style="margin-top:6px;">Al ser una presencial y una virtual, igual puedes guardar e inscribir a la persona en ambas.</p>
    </div>`;
  }
  return html;
}

function wireFormExtras(modal) {
  const search = modal.querySelector('#cal-participant-search');
  const results = modal.querySelector('#cal-dir-results');
  if (search) search.addEventListener('input', () => {
    clearTimeout(_dirDebounce);
    const q = search.value.trim();
    if (!q) { results.style.display = 'none'; results.innerHTML = ''; return; }
    _dirDebounce = setTimeout(async () => {
      try {
        _dirResults = await Store.searchDirectory({ q });
        results.innerHTML = _dirResults.length
          ? _dirResults.map(p => `
              <button type="button" class="cal-dir-pick" data-id="${p.user_id}" style="display:flex;justify-content:space-between;width:100%;text-align:left;padding:8px 12px;border:0;background:none;cursor:pointer;font-size:13.5px;">
                <span>${escapeHtml(fullName(p))}</span>
                <span class="cell-sub">${escapeHtml(p.area || '—')}${p.cargo ? ' · ' + escapeHtml(p.cargo) : ''}</span>
              </button>`).join('')
          : '<p class="cell-sub" style="padding:8px 12px;">Sin resultados</p>';
        results.style.display = 'block';
        results.querySelectorAll('.cal-dir-pick').forEach(btn => btn.addEventListener('click', () => {
          const person = _dirResults.find(p => String(p.user_id) === btn.dataset.id);
          if (person && !_selectedParticipants.some(p => p.user_id === person.user_id)) {
            _selectedParticipants.push(person);
            modal.querySelector('#cal-selected-participants').innerHTML = selectedParticipantsHtml();
            wireRemoveParticipants(modal);
            liveCheck(modal);
          }
          search.value = ''; results.style.display = 'none'; results.innerHTML = '';
        }));
      } catch { /* silencioso */ }
    }, 250);
  });
  wireRemoveParticipants(modal);

  const extAdd = modal.querySelector('#cal-ext-add');
  if (extAdd) extAdd.addEventListener('click', () => {
    const nameEl = modal.querySelector('#cal-ext-name');
    const kindEl = modal.querySelector('#cal-ext-kind');
    const name = nameEl.value.trim();
    if (!name) return;
    _externalParticipants.push({ name, kind: kindEl.value });
    nameEl.value = '';
    modal.querySelector('#cal-selected-externals').innerHTML = selectedExternalsHtml();
    wireRemoveExternals(modal);
  });
  wireRemoveExternals(modal);
}

function wireRemoveParticipants(modal) {
  modal.querySelectorAll('.cal-remove-participant').forEach(btn => btn.addEventListener('click', () => {
    _selectedParticipants = _selectedParticipants.filter(p => String(p.user_id) !== btn.dataset.id);
    modal.querySelector('#cal-selected-participants').innerHTML = selectedParticipantsHtml();
    wireRemoveParticipants(modal);
    liveCheck(modal);
  }));
}
function wireRemoveExternals(modal) {
  modal.querySelectorAll('.cal-remove-external').forEach(btn => btn.addEventListener('click', () => {
    _externalParticipants.splice(Number(btn.dataset.i), 1);
    modal.querySelector('#cal-selected-externals').innerHTML = selectedExternalsHtml();
    wireRemoveExternals(modal);
  }));
}

async function liveCheck(modal) {
  const form = modal.querySelector('#meeting-form');
  if (!form) return;
  const date = form.elements.date.value;
  const start = form.elements.start_time.value;
  const end = form.elements.end_time.value;
  const saveBtn = modal.querySelector('#cal-save-btn');
  const ids = _selectedParticipants.map(p => p.user_id);
  const modality = form.elements.modality?.value || 'presencial';

  if (!date || !start || !end || !ids.length || end <= start) {
    _conflicts = [];
    modal.querySelector('#cal-conflict-banner').innerHTML = '';
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  const token = ++_checkToken;
  let conflicts = [];
  try {
    const res = await Store.checkAvailability({ date, start_time: start, end_time: end, participant_ids: ids, exclude_meeting_id: _editingId || undefined, modality });
    conflicts = res.conflicts || [];
  } catch { conflicts = []; }
  if (token !== _checkToken) return;
  _conflicts = conflicts;
  modal.querySelector('#cal-conflict-banner').innerHTML = conflictBannerHtml();
  if (saveBtn) saveBtn.disabled = _conflicts.some(c => c.hard);
}

async function submitForm(modal) {
  const form = modal.querySelector('#meeting-form');
  if (!form.reportValidity()) return;
  const title = form.elements.title.value.trim();
  const date = form.elements.date.value;
  const start_time = form.elements.start_time.value;
  const end_time = form.elements.end_time.value;
  const meeting_type = form.elements.meeting_type.value;
  const modality = form.elements.modality?.value || 'presencial';
  const location = form.elements.location.value.trim();
  const motivo = form.elements.motivo.value.trim();
  const description = form.elements.description.value.trim();

  if (!title) return toast('El nombre de la reunión es requerido', 'error');
  if (end_time <= start_time) return toast('La hora de fin debe ser posterior a la de inicio', 'error');
  if (!_selectedParticipants.length && !_externalParticipants.length) return toast('Selecciona al menos un participante', 'error');

  const editing = _meetings.find(m => m.id === _editingId);
  const image_url = _pendingImage !== null ? _pendingImage : (editing?.image_url || null);

  const payload = {
    title, date, start_time, end_time, meeting_type, modality, location, motivo, description, image_url,
    participants: _selectedParticipants.map(p => ({ user_id: p.user_id })),
    external_participants: _externalParticipants,
  };

  try {
    if (_editingId) { await Store.updateMeeting(_editingId, payload); toast('Reunión actualizada', 'success'); }
    else { await Store.addMeeting(payload); toast('Reunión programada', 'success'); }
    closeModal();
    await load();
  } catch (err) {
    if (err.message === 'Existen conflictos de horario') {
      toast(err.message, 'error');
    } else {
      toast(err.message || 'Error', 'error');
    }
  }
}

async function cancelMeeting(id) {
  const m = _meetings.find(x => x.id === id);
  if (!m) return;
  const ok = await confirmDialog(`¿Deseas cancelar la reunión "${m.title}"? Se liberará el horario de los participantes.`, { confirmLabel: 'Cancelar reunión' });
  if (!ok) return;
  try { await Store.cancelMeeting(id); toast('Reunión cancelada', 'success'); await load(); }
  catch (err) { toast(err.message || 'Error', 'error'); }
}

async function deleteMeeting(id) {
  const m = _meetings.find(x => x.id === id);
  if (!m) return;
  const ok = await confirmDialog(`¿Deseas eliminar la reunión "${m.title}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try { await Store.deleteMeeting(id); toast('Reunión eliminada', 'success'); await load(); }
  catch (err) { toast(err.message || 'Error', 'error'); }
}

function viewMeeting(id) {
  const m = _meetings.find(x => x.id === id);
  if (!m || m.visibility === 'busy_only') return;
  const participantsHtml = (m.participants || []).map(p => p.participant_type === 'external'
    ? `<li>${escapeHtml(p.external_name)} — ${EXTERNAL_KINDS.find(k=>k[0]===p.external_kind)?.[1] || p.external_kind} (externo)</li>`
    : `<li>${escapeHtml(p.user_name || '—')}${p.user_area ? ' — ' + escapeHtml(p.user_area) : ''}${p.user_cargo ? ' — ' + escapeHtml(p.user_cargo) : ''}</li>`).join('');
  openModal({
    title: m.title,
    bodyHtml: `
      <div style="font-size:13.5px;display:flex;flex-direction:column;gap:8px;">
        ${m.image_url ? `<img src="${escapeHtml(m.image_url)}" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">` : ''}
        <p><strong>Área:</strong> ${escapeHtml(m.area)}</p>
        <p><strong>Fecha:</strong> ${fmtDateOnly(m.meeting_date)}</p>
        <p><strong>Horario:</strong> ${m.start_time.slice(0,5)} — ${m.end_time.slice(0,5)}</p>
        ${m.meeting_type ? `<p><strong>Tipo:</strong> ${escapeHtml(m.meeting_type)}</p>` : ''}
        <p>${modalityIconHtml(m)}</p>
        ${m.location ? `<p><strong>${m.modality === 'virtual' ? 'Link' : 'Dirección'}:</strong> ${escapeHtml(m.location)}</p>` : ''}
        ${m.motivo ? `<p><strong>Motivo:</strong> ${escapeHtml(m.motivo)}</p>` : ''}
        ${m.description ? `<div><strong>Descripción:</strong><p style="margin-top:4px;white-space:pre-wrap">${escapeHtml(m.description)}</p></div>` : ''}
        <div><strong>Participantes:</strong><ul style="margin:4px 0 0 18px;padding:0;">${participantsHtml || '<li>Sin participantes</li>'}</ul></div>
        <p class="cell-sub">Programada por ${escapeHtml(m.created_by_name || '—')}</p>
      </div>
    `,
    footerHtml: `<button class="btn btn-secondary" data-close>Cerrar</button>`,
  });
}
