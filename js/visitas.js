import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTimeSec } from './utils.js';
import { toast, openModal } from './ui.js';
import { singleBarChart, donutChart, DONUT_COLORS } from './charts.js';

const EVENT_TYPES = [
  ['page_view', 'Vista de página'],
  ['case_click', 'Click en caso de éxito'],
  ['whatsapp_click', 'Click en WhatsApp'],
  ['chatbot_open', 'Abrió el chatbot'],
  ['chatbot_message', 'Mensaje al chatbot'],
];
const EVENT_BADGE = {
  page_view: 'badge-gray', case_click: 'badge-green', whatsapp_click: 'badge-green',
  chatbot_open: 'badge-amber', chatbot_message: 'badge-amber',
};
const DEVICE_ICON = { 'Móvil': 'smartphone', 'Tablet': 'smartphone', 'Escritorio': 'monitor', 'Desconocido': 'globe' };

let _tab = 'sessions'; // 'sessions' | 'events'
let _days = 30;
let _summary = null;

// Sesiones (viajes de visitante)
let _sRows = [];
let _sTotal = 0;
let _sOffset = 0;
const S_PAGE_SIZE = 30;
let _sFilters = { q: '', only_leads: false };

// Eventos crudos
let _rows = [];
let _total = 0;
let _offset = 0;
const PAGE_SIZE = 50;
let _filters = { event_type: '', date_from: '', date_to: '', q: '' };

export function renderVisitas() {
  const container = document.getElementById('view-visitas');
  container.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>Cargando visitas…</p></div></div>`;
  _offset = 0;
  _sOffset = 0;
  loadAll();
}

async function loadAll() {
  try {
    const [summary, sessions] = await Promise.all([
      Store.getAnalyticsSummary(_days),
      Store.getAnalyticsSessions(sessionParams()),
    ]);
    _summary = summary;
    _sRows = sessions.rows;
    _sTotal = sessions.total;
    renderPage();
  } catch (err) {
    const container = document.getElementById('view-visitas');
    if (container) container.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p><strong>No se pudo cargar Visitas</strong></p><p>${escapeHtml(err.message || '')}</p></div></div>`;
  }
}

function sessionParams() {
  return {
    days: _days,
    q: _sFilters.q || undefined,
    only_leads: _sFilters.only_leads ? 1 : undefined,
    limit: S_PAGE_SIZE, offset: _sOffset,
  };
}

async function reloadSessions(append = false) {
  try {
    const data = await Store.getAnalyticsSessions(sessionParams());
    _sRows = append ? [..._sRows, ...data.rows] : data.rows;
    _sTotal = data.total;
    renderSessionsTable();
    renderSessionsFooter();
  } catch (err) { toast(err.message || 'Error al cargar sesiones', 'error'); }
}

function eventParams() {
  return {
    event_type: _filters.event_type || undefined,
    date_from: _filters.date_from || undefined,
    date_to: _filters.date_to || undefined,
    q: _filters.q || undefined,
    limit: PAGE_SIZE, offset: _offset,
  };
}

async function reloadEvents(append = false) {
  try {
    const data = await Store.getAnalyticsEvents(eventParams());
    _rows = append ? [..._rows, ...data.rows] : data.rows;
    _total = data.total;
    renderEventsTable();
    renderEventsFooter();
  } catch (err) { toast(err.message || 'Error al cargar eventos', 'error'); }
}

function renderPage() {
  const container = document.getElementById('view-visitas');
  if (!container) return;
  container.innerHTML = rangeHtml() + kpiHtml() + chartsHtml() + tabsHtml();
  document.getElementById('vis-range')?.addEventListener('change', e => { _days = Number(e.target.value); _sOffset = 0; _offset = 0; loadAll(); });
  wireTabs();
  if (_tab === 'sessions') {
    renderSessionsTable();
    renderSessionsFooter();
    wireSessionFilters();
  } else {
    if (_rows.length === 0 && _total === 0) reloadEvents();
    else { renderEventsTable(); renderEventsFooter(); }
    wireFilters();
  }
}

function rangeHtml() {
  return `
  <div class="toolbar" style="margin-bottom:4px">
    <div class="toolbar__filters">
      <span style="font-size:12.5px;color:var(--text-muted)">Rango de las estadísticas:</span>
      <select id="vis-range">
        <option value="7"  ${_days === 7 ? 'selected' : ''}>Últimos 7 días</option>
        <option value="30" ${_days === 30 ? 'selected' : ''}>Últimos 30 días</option>
        <option value="90" ${_days === 90 ? 'selected' : ''}>Últimos 90 días</option>
      </select>
    </div>
  </div>`;
}

function kpiHtml() {
  const s = _summary;
  return `
  <div class="kpi-grid">
    <div class="kpi-card">
      <div><div class="kpi-card__label">Vistas de página</div><div class="kpi-card__value">${s.total_views}</div><div class="kpi-card__hint">últimos ${s.days} días</div></div>
      <div class="kpi-card__icon blue">${icon('eye')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Visitantes únicos</div><div class="kpi-card__value">${s.unique_visitors}</div><div class="kpi-card__hint">${s.new_visitors ?? 0} nuevos · ${s.returning_visitors ?? 0} recurrentes</div></div>
      <div class="kpi-card__icon green">${icon('users')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Leads calientes</div><div class="kpi-card__value">${s.hot_leads ?? 0}</div><div class="kpi-card__hint">escribieron o mandaron WhatsApp</div></div>
      <div class="kpi-card__icon red">${icon('flame')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Clicks en WhatsApp</div><div class="kpi-card__value">${s.whatsapp_clicks}</div><div class="kpi-card__hint">flotante + botones de contacto</div></div>
      <div class="kpi-card__icon green">${icon('message-circle')}</div>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div><div class="kpi-card__label">Visitantes nuevos</div><div class="kpi-card__value">${s.new_visitors ?? 0}</div><div class="kpi-card__hint">primera vez en este rango</div></div>
      <div class="kpi-card__icon blue">${icon('user-plus')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Recurrentes</div><div class="kpi-card__value">${s.returning_visitors ?? 0}</div><div class="kpi-card__hint">ya habían visitado antes</div></div>
      <div class="kpi-card__icon amber">${icon('user-check')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Clicks en casos de éxito</div><div class="kpi-card__value">${s.case_clicks}</div><div class="kpi-card__hint">botón "Ver sitio"</div></div>
      <div class="kpi-card__icon amber">${icon('external-link')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Preguntas al chatbot</div><div class="kpi-card__value">${s.chatbot_messages}</div><div class="kpi-card__hint">mensajes enviados</div></div>
      <div class="kpi-card__icon amber">${icon('activity')}</div>
    </div>
  </div>`;
}

function chartsHtml() {
  const s = _summary;
  const cases = s.top_cases || [];
  const legend = cases.map((c, i) => `
    <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:5px 0;min-width:180px">
      <span style="width:10px;height:10px;border-radius:50%;background:${DONUT_COLORS[i % DONUT_COLORS.length]};flex-shrink:0"></span>
      <span style="color:var(--text);flex:1">${escapeHtml(c.case_name)}</span>
      <span style="color:var(--text-muted);font-variant-numeric:tabular-nums">${c.total}</span>
    </div>`).join('');

  const devices = s.device_breakdown || [];
  const deviceLegend = devices.map((d, i) => `
    <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:5px 0;min-width:150px">
      <span style="width:10px;height:10px;border-radius:50%;background:${DONUT_COLORS[i % DONUT_COLORS.length]};flex-shrink:0"></span>
      <span style="color:var(--text);flex:1;display:flex;align-items:center;gap:5px">${icon(DEVICE_ICON[d.device] || 'globe', 'icon icon-sm')}${escapeHtml(d.device)}</span>
      <span style="color:var(--text-muted);font-variant-numeric:tabular-nums">${d.total}</span>
    </div>`).join('');

  return `
  <div class="card" style="margin-bottom:16px">
    <div class="card__header"><h3>Vistas de página por día (${s.days} días)</h3></div>
    <div class="card__body">
      ${(s.views_by_day || []).length === 0
        ? '<p style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:12.5px">Sin vistas registradas en este rango.</p>'
        : singleBarChart(s.views_by_day, { key: 'total', color: 'var(--primary)' })}
    </div>
  </div>
  <div class="panels-grid">
    <div class="card">
      <div class="card__header"><h3>Casos de éxito más clickeados</h3></div>
      <div class="card__body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        ${cases.length === 0
          ? '<p style="font-size:12px;color:var(--text-muted)">Sin clicks todavía en este rango.</p>'
          : donutChart(cases.map(c => ({ label: c.case_name, value: c.total })), { colors: DONUT_COLORS, holeLabel: 'clicks' })}
        <div style="display:flex;flex-direction:column;gap:6px">${legend}</div>
      </div>
    </div>
    <div class="card">
      <div class="card__header"><h3>Dispositivos</h3></div>
      <div class="card__body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        ${devices.length === 0
          ? '<p style="font-size:12px;color:var(--text-muted)">Sin datos en este rango.</p>'
          : donutChart(devices.map(d => ({ label: d.device, value: d.total })), { colors: DONUT_COLORS, holeLabel: 'visitas' })}
        <div style="display:flex;flex-direction:column;gap:6px">${deviceLegend}</div>
      </div>
    </div>
    <div class="card">
      <div class="card__header"><h3>Páginas más vistas</h3></div>
      <div class="card__body">
        ${(s.top_pages || []).length === 0
          ? '<p style="font-size:12.5px;color:var(--text-muted)">Sin datos en este rango.</p>'
          : `<div class="mini-list">${s.top_pages.map(p => `
              <div class="mini-row"><span style="font-size:12.5px">${escapeHtml(p.page)}</span><span class="tag">${p.total}</span></div>`).join('')}</div>`}
      </div>
    </div>
    <div class="card">
      <div class="card__header"><h3>De dónde llegan</h3></div>
      <div class="card__body">
        ${(s.top_referrers || []).length === 0
          ? '<p style="font-size:12.5px;color:var(--text-muted)">Sin referencias externas en este rango (entran directo).</p>'
          : `<div class="mini-list">${s.top_referrers.map(r => `
              <div class="mini-row"><span style="font-size:12.5px" title="${escapeHtml(r.referrer)}">${escapeHtml(referrerHost(r.referrer))}</span><span class="tag">${r.total}</span></div>`).join('')}</div>`}
      </div>
    </div>
  </div>`;
}

function tabsHtml() {
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:4px;margin-bottom:12px">
    <div style="display:flex;gap:8px">
      <button class="btn ${_tab === 'sessions' ? 'btn-primary' : 'btn-secondary'}" id="vis-tab-sessions">${icon('users')} Sesiones</button>
      <button class="btn ${_tab === 'events' ? 'btn-primary' : 'btn-secondary'}" id="vis-tab-events">${icon('activity')} Eventos crudos</button>
    </div>
  </div>
  <div id="vis-tab-body">${_tab === 'sessions' ? sessionsShellHtml() : eventsShellHtml()}</div>`;
}

function wireTabs() {
  document.getElementById('vis-tab-sessions')?.addEventListener('click', () => {
    if (_tab === 'sessions') return;
    _tab = 'sessions';
    renderPage();
  });
  document.getElementById('vis-tab-events')?.addEventListener('click', () => {
    if (_tab === 'events') return;
    _tab = 'events';
    renderPage();
  });
}

// ─── Sesiones (viaje del visitante) ────────────────────────────────────────

function sessionsShellHtml() {
  return `
  <div class="toolbar">
    <div class="toolbar__filters">
      <div class="search-box">
        ${icon('search')}
        <input type="text" id="vis-s-q" placeholder="Buscar caso, página, origen..." value="${escapeHtml(_sFilters.q)}">
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted);cursor:pointer">
        <input type="checkbox" id="vis-s-leads" ${_sFilters.only_leads ? 'checked' : ''}> Solo leads calientes 🔥
      </label>
    </div>
  </div>
  <div id="sessions-table-wrap"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:12.5px;color:var(--text-muted)">
    <span id="sessions-count"></span>
    <button class="btn btn-secondary" id="sessions-load-more" style="display:none">Cargar más</button>
  </div>`;
}

function referrerHost(ref) {
  if (!ref) return '—';
  try { return new URL(ref).hostname; } catch { return ref.slice(0, 40); }
}

function sessionRowHtml(r) {
  const cases = (r.cases || []).slice(0, 2).map(c => `<span class="tag" style="margin-right:4px">${escapeHtml(c)}</span>`).join('');
  const casesExtra = (r.cases || []).length > 2 ? `<span class="tag">+${r.cases.length - 2}</span>` : '';
  return `
  <tr class="vis-session-row" data-session="${escapeHtml(r.session_id)}" style="cursor:pointer">
    <td class="cell-sub" style="white-space:nowrap">${formatDateTimeSec(r.last_seen)}</td>
    <td>
      <div style="display:flex;align-items:center;gap:6px">
        ${icon(DEVICE_ICON[r.device] || 'globe', 'icon icon-sm')}
        <span style="font-size:12.5px">${escapeHtml(r.device)} · ${escapeHtml(r.browser)}</span>
      </div>
    </td>
    <td class="cell-sub">${r.page_views}</td>
    <td>${cases || '<span class="cell-sub">—</span>'}${casesExtra}</td>
    <td class="cell-sub">${r.whatsapp_clicks > 0 ? `${icon('message-circle', 'icon icon-sm')} ${r.whatsapp_clicks}` : '—'}</td>
    <td class="cell-sub">${r.chatbot_messages > 0 ? `${icon('activity', 'icon icon-sm')} ${r.chatbot_messages}` : '—'}</td>
    <td>${r.is_lead ? '<span class="badge badge-red">🔥 Lead</span>' : ''}</td>
  </tr>`;
}

function renderSessionsTable() {
  const wrap = document.getElementById('sessions-table-wrap');
  if (!wrap) return;
  if (_sRows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('users')}<p><strong>Sin sesiones en este rango</strong></p></div></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Última visita</th><th>Dispositivo</th><th>Páginas</th><th>Casos vistos</th><th>WhatsApp</th><th>Chatbot</th><th></th></tr></thead>
        <tbody>${_sRows.map(sessionRowHtml).join('')}</tbody>
      </table>
    </div>`;
  wrap.querySelectorAll('.vis-session-row').forEach(tr => {
    tr.addEventListener('click', () => openSessionTimeline(tr.dataset.session));
  });
}

function renderSessionsFooter() {
  const count = document.getElementById('sessions-count');
  const more = document.getElementById('sessions-load-more');
  if (count) count.textContent = `${_sRows.length} de ${_sTotal} sesiones`;
  if (more) {
    more.style.display = _sRows.length < _sTotal ? 'inline-flex' : 'none';
    more.onclick = () => { _sOffset += S_PAGE_SIZE; reloadSessions(true); };
  }
}

function wireSessionFilters() {
  let qDebounce;
  document.getElementById('vis-s-q')?.addEventListener('input', e => {
    clearTimeout(qDebounce);
    qDebounce = setTimeout(() => { _sFilters.q = e.target.value; _sOffset = 0; reloadSessions(); }, 350);
  });
  document.getElementById('vis-s-leads')?.addEventListener('change', e => {
    _sFilters.only_leads = e.target.checked; _sOffset = 0; reloadSessions();
  });
}

const TIMELINE_ICON = {
  page_view: 'eye', case_click: 'external-link', whatsapp_click: 'message-circle',
  chatbot_open: 'message-circle', chatbot_message: 'activity',
};

async function openSessionTimeline(sessionId) {
  openModal({
    title: 'Recorrido del visitante',
    size: 'lg',
    bodyHtml: `<div id="vis-timeline-body"><p style="color:var(--text-muted);font-size:12.5px">Cargando recorrido…</p></div>`,
  });
  try {
    const data = await Store.getSessionTimeline(sessionId);
    const body = document.getElementById('vis-timeline-body');
    if (!body) return;
    if (!data.events.length) {
      body.innerHTML = `<p style="color:var(--text-muted);font-size:12.5px">Sin eventos para esta sesión.</p>`;
      return;
    }
    const header = `
      <div style="display:flex;flex-wrap:wrap;gap:16px;padding:10px 12px;background:var(--gray-bg);border-radius:8px;margin-bottom:16px;font-size:12.5px;color:var(--text-muted)">
        <span style="display:flex;align-items:center;gap:5px">${icon(DEVICE_ICON[data.device] || 'globe', 'icon icon-sm')} ${escapeHtml(data.device || '—')}</span>
        <span>${escapeHtml(data.browser || '—')}</span>
        <span>${escapeHtml(data.os || '—')}</span>
        <span style="display:flex;align-items:center;gap:5px">${icon('map-pin', 'icon icon-sm')} ${escapeHtml(data.ip_address || '—')}</span>
      </div>`;
    const items = data.events.map(ev => `
      <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div class="kpi-card__icon ${EVENT_BADGE[ev.event_type] === 'badge-green' ? 'green' : EVENT_BADGE[ev.event_type] === 'badge-amber' ? 'amber' : 'gray'}" style="width:32px;height:32px;flex-shrink:0">${icon(TIMELINE_ICON[ev.event_type] || 'activity', 'icon icon-sm')}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:12.5px">${escapeHtml(ev.event_label)}</strong>
            <span style="font-size:11.5px;color:var(--text-muted)">${formatDateTimeSec(ev.created_at)}</span>
          </div>
          ${(ev.case_name || ev.label) ? `<p style="margin:3px 0 0;font-size:12.5px;color:var(--text-muted);word-break:break-word">${escapeHtml(ev.case_name || ev.label)}</p>` : ''}
          ${ev.page ? `<p style="margin:2px 0 0;font-size:11.5px;color:var(--text-muted)">${escapeHtml(ev.page)}</p>` : ''}
        </div>
      </div>`).join('');
    body.innerHTML = header + `<div>${items}</div>`;
  } catch (err) {
    const body = document.getElementById('vis-timeline-body');
    if (body) body.innerHTML = `<p style="color:var(--danger);font-size:12.5px">${escapeHtml(err.message || 'Error al cargar el recorrido')}</p>`;
  }
}

// ─── Eventos crudos (tabla plana, como antes) ──────────────────────────────

function eventsShellHtml() {
  return `
  <div class="toolbar">
    <div class="toolbar__filters">
      <select id="vis-f-type">
        <option value="">Todos los eventos</option>
        ${EVENT_TYPES.map(([k, l]) => `<option value="${k}" ${_filters.event_type === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input type="date" id="vis-f-date-from" value="${_filters.date_from}">
      <input type="date" id="vis-f-date-to" value="${_filters.date_to}">
      <div class="search-box">
        ${icon('search')}
        <input type="text" id="vis-f-q" placeholder="Buscar caso, página, origen..." value="${escapeHtml(_filters.q)}">
      </div>
    </div>
  </div>
  <div id="visitas-table-wrap"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:12.5px;color:var(--text-muted)">
    <span id="visitas-count"></span>
    <button class="btn btn-secondary" id="visitas-load-more" style="display:none">Cargar más</button>
  </div>`;
}

function rowHtml(r) {
  const detail = r.case_name || r.label || '—';
  const detailShort = detail.length > 60 ? detail.slice(0, 60) + '…' : detail;
  return `
  <tr>
    <td class="cell-sub" style="white-space:nowrap">${formatDateTimeSec(r.created_at)}</td>
    <td><span class="badge ${EVENT_BADGE[r.event_type] || 'badge-gray'}">${escapeHtml(r.event_label)}</span></td>
    <td class="cell-sub" title="${escapeHtml(detail)}">${escapeHtml(detailShort)}</td>
    <td class="cell-sub">${escapeHtml(r.page || '—')}</td>
    <td class="cell-sub" title="${escapeHtml(r.referrer || '')}">${escapeHtml(referrerHost(r.referrer))}</td>
    <td class="cell-sub">${escapeHtml(r.ip_address || '—')}</td>
  </tr>`;
}

function renderEventsTable() {
  const wrap = document.getElementById('visitas-table-wrap');
  if (!wrap) return;
  if (_rows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('bar-chart-2')}<p><strong>Sin eventos en este rango</strong></p></div></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th><th>Página</th><th>Origen</th><th>IP</th></tr></thead>
        <tbody>${_rows.map(rowHtml).join('')}</tbody>
      </table>
    </div>`;
}

function renderEventsFooter() {
  const count = document.getElementById('visitas-count');
  const more = document.getElementById('visitas-load-more');
  if (count) count.textContent = `${_rows.length} de ${_total}`;
  if (more) more.style.display = _rows.length < _total ? 'inline-flex' : 'none';
}

function wireFilters() {
  document.getElementById('vis-f-type')?.addEventListener('change', e => { _filters.event_type = e.target.value; _offset = 0; reloadEvents(); });
  document.getElementById('vis-f-date-from')?.addEventListener('change', e => { _filters.date_from = e.target.value; _offset = 0; reloadEvents(); });
  document.getElementById('vis-f-date-to')?.addEventListener('change', e => { _filters.date_to = e.target.value; _offset = 0; reloadEvents(); });
  let qDebounce;
  document.getElementById('vis-f-q')?.addEventListener('input', e => {
    clearTimeout(qDebounce);
    qDebounce = setTimeout(() => { _filters.q = e.target.value; _offset = 0; reloadEvents(); }, 350);
  });
  document.getElementById('visitas-load-more')?.addEventListener('click', () => { _offset += PAGE_SIZE; reloadEvents(true); });
}
