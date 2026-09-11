import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTimeSec } from './utils.js';
import { toast } from './ui.js';
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

let _days = 30;
let _summary = null;

let _rows = [];
let _total = 0;
let _offset = 0;
const PAGE_SIZE = 50;
let _filters = { event_type: '', date_from: '', date_to: '', q: '' };

export function renderVisitas() {
  const container = document.getElementById('view-visitas');
  container.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>Cargando visitas…</p></div></div>`;
  _offset = 0;
  loadAll();
}

async function loadAll() {
  try {
    const [summary, events] = await Promise.all([
      Store.getAnalyticsSummary(_days),
      Store.getAnalyticsEvents(eventParams()),
    ]);
    _summary = summary;
    _rows = events.rows;
    _total = events.total;
    renderPage();
  } catch (err) {
    const container = document.getElementById('view-visitas');
    if (container) container.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p><strong>No se pudo cargar Visitas</strong></p><p>${escapeHtml(err.message || '')}</p></div></div>`;
  }
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
  container.innerHTML = rangeHtml() + kpiHtml() + chartsHtml() + tableShellHtml();
  document.getElementById('vis-range')?.addEventListener('change', e => { _days = Number(e.target.value); loadAll(); });
  renderEventsTable();
  renderEventsFooter();
  wireFilters();
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
      <div><div class="kpi-card__label">Visitantes únicos</div><div class="kpi-card__value">${s.unique_visitors}</div><div class="kpi-card__hint">por dispositivo/navegador</div></div>
      <div class="kpi-card__icon green">${icon('users')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Clicks en casos de éxito</div><div class="kpi-card__value">${s.case_clicks}</div><div class="kpi-card__hint">botón "Ver sitio"</div></div>
      <div class="kpi-card__icon amber">${icon('external-link')}</div>
    </div>
    <div class="kpi-card">
      <div><div class="kpi-card__label">Clicks en WhatsApp</div><div class="kpi-card__value">${s.whatsapp_clicks}</div><div class="kpi-card__hint">flotante + botones de contacto</div></div>
      <div class="kpi-card__icon green">${icon('message-circle')}</div>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div><div class="kpi-card__label">Chatbot abierto</div><div class="kpi-card__value">${s.chatbot_opens}</div><div class="kpi-card__hint">veces que lo abrieron</div></div>
      <div class="kpi-card__icon amber">${icon('message-circle')}</div>
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
      <div class="card__header"><h3>Páginas más vistas</h3></div>
      <div class="card__body">
        ${(s.top_pages || []).length === 0
          ? '<p style="font-size:12.5px;color:var(--text-muted)">Sin datos en este rango.</p>'
          : `<div class="mini-list">${s.top_pages.map(p => `
              <div class="mini-row"><span style="font-size:12.5px">${escapeHtml(p.page)}</span><span class="tag">${p.total}</span></div>`).join('')}</div>`}
      </div>
    </div>
  </div>`;
}

function tableShellHtml() {
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

function referrerHost(ref) {
  if (!ref) return '—';
  try { return new URL(ref).hostname; } catch { return ref.slice(0, 40); }
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
