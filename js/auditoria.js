import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTimeSec } from './utils.js';

const AREAS = [['RRHH', 'RR. HH.'], ['ADG', 'ADG'], ['TI', 'TI'], ['SOPORTE', 'Soporte']];
const ACTION_LABEL = {
  view: 'Consultó', create: 'Creó', update: 'Actualizó', delete: 'Eliminó',
  login: 'Inició sesión', logout: 'Cerró sesión', access_denied: 'Acceso denegado',
  permission_change: 'Cambió permisos', account_suspended: 'Suspendió cuenta',
  account_unsuspended: 'Reactivó cuenta', session_revoked: 'Cerró sesión (admin)',
  account_locked: 'Cuenta bloqueada', ip_blocked: 'Bloqueó IP', ip_status_changed: 'Cambió estado de IP',
  ip_blocked_attempt: 'Intento desde IP bloqueada', ip_marked_suspicious: 'IP marcada sospechosa',
  handoff_used: 'Traspaso de sesión',
};

let _rows = [];
let _total = 0;
let _offset = 0;
const PAGE_SIZE = 50;
/* DST solo lo usan cuentas nivel_acceso>=100, así que siempre ve todas
   las áreas — a diferencia de los otros paneles, acá "area" por
   defecto es ALL (no la propia área, que ni siquiera aplica a una
   cuenta de administración de seguridad). */
let _filters = { area: 'ALL', action_type: '', date_from: '', date_to: '', q: '' };

export function renderAuditoria() {
  const container = document.getElementById('view-auditoria');
  container.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>Cargando auditoría…</p></div></div>`;
  _offset = 0;
  load();
}

async function load(append = false) {
  const container = document.getElementById('view-auditoria');
  try {
    const params = {
      area: _filters.area || 'ALL',
      action_type: _filters.action_type || undefined,
      date_from: _filters.date_from || undefined,
      date_to: _filters.date_to || undefined,
      q: _filters.q || undefined,
      limit: PAGE_SIZE, offset: _offset,
    };
    const data = await Store.getAuditLogs(params);
    _rows = append ? [..._rows, ...data.rows] : data.rows;
    _total = data.total;
    renderPage();
  } catch (err) {
    if (container) container.innerHTML = `<div class="table-wrap"><div class="empty-state"><p>${escapeHtml(err.message || 'Error al cargar la auditoría')}</p></div></div>`;
  }
}

function renderPage() {
  const container = document.getElementById('view-auditoria');
  if (!container) return;
  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__filters">
        <select id="aud-f-area">
          <option value="ALL" ${_filters.area === 'ALL' ? 'selected' : ''}>Todas las áreas</option>
          ${AREAS.map(([k, l]) => `<option value="${k}" ${_filters.area === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="aud-f-action">
          <option value="">Todas las acciones</option>
          ${Object.entries(ACTION_LABEL).map(([k, l]) => `<option value="${k}" ${_filters.action_type === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <input type="date" id="aud-f-date-from" value="${_filters.date_from}">
        <input type="date" id="aud-f-date-to" value="${_filters.date_to}">
        <div class="search-box">
          ${icon('search')}
          <input type="text" id="aud-f-q" placeholder="Buscar en la ruta..." value="${escapeHtml(_filters.q)}">
        </div>
      </div>
    </div>
    <div id="audit-table-wrap"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:12.5px;color:var(--text-muted)">
      <span id="audit-count">${_rows.length} de ${_total}</span>
      <button class="btn btn-secondary" id="audit-load-more" style="display:${_rows.length < _total ? 'inline-flex' : 'none'}">Cargar más</button>
    </div>
  `;
  renderTable();
  wire();
}

function wire() {
  document.getElementById('aud-f-area')?.addEventListener('change', e => { _filters.area = e.target.value; _offset = 0; load(); });
  document.getElementById('aud-f-action')?.addEventListener('change', e => { _filters.action_type = e.target.value; _offset = 0; load(); });
  document.getElementById('aud-f-date-from')?.addEventListener('change', e => { _filters.date_from = e.target.value; _offset = 0; load(); });
  document.getElementById('aud-f-date-to')?.addEventListener('change', e => { _filters.date_to = e.target.value; _offset = 0; load(); });
  let qDebounce;
  document.getElementById('aud-f-q')?.addEventListener('input', e => {
    clearTimeout(qDebounce);
    qDebounce = setTimeout(() => { _filters.q = e.target.value; _offset = 0; load(); }, 350);
  });
  document.getElementById('audit-load-more')?.addEventListener('click', () => { _offset += PAGE_SIZE; load(true); });
}

function renderTable() {
  const wrap = document.getElementById('audit-table-wrap');
  if (!wrap) return;

  if (_rows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('eye')}<p><strong>Sin movimientos en este rango</strong></p></div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Fecha</th><th>Usuario</th><th>Área</th><th>Acción</th><th>Detalle</th></tr>
        </thead>
        <tbody>
          ${_rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;
}

function changeValueText(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function changesHtml(changes) {
  if (!changes || typeof changes !== 'object') return '';
  const entries = Object.entries(changes);
  if (!entries.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
    ${entries.map(([k, v]) => `<span style="display:inline-flex;gap:4px;padding:2px 6px;border-radius:4px;background:var(--bg,#f9fafb);border:1px solid var(--border);font-size:11px;color:var(--text-muted)">
      <strong style="color:var(--text)">${escapeHtml(k)}:</strong> ${escapeHtml(changeValueText(v))}
    </span>`).join('')}
  </div>`;
}

function rowHtml(r) {
  const path = r.full_path || r.path;
  return `
  <tr>
    <td class="cell-sub" style="vertical-align:top">${formatDateTimeSec(r.created_at)}</td>
    <td class="cell-main" style="vertical-align:top">${escapeHtml(r.user_name || r.username || '—')}</td>
    <td class="cell-sub" style="vertical-align:top">${escapeHtml(r.area || '—')}</td>
    <td style="vertical-align:top"><span class="tag">${escapeHtml(ACTION_LABEL[r.action_type] || r.action_type)}</span></td>
    <td class="cell-sub" style="vertical-align:top">
      <span title="${escapeHtml(path)}">${escapeHtml(r.description)} · ${escapeHtml(r.method)} ${escapeHtml(path)}</span>
      ${changesHtml(r.changes)}
    </td>
  </tr>`;
}
