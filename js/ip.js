import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast } from './ui.js';

const CATEGORY_LABEL = { observacion: 'En observación', bloqueada: 'Bloqueada', autorizada: 'Autorizada', sospechosa: 'Sospechosa' };
let _category = 'observacion';
let _rows = [];
let _q = '';
let _qDebounce;

export function renderIp() {
  const container = document.getElementById('view-ip');
  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__filters" id="ip-tabs">
        ${Object.entries(CATEGORY_LABEL).map(([k, l]) => `<button type="button" class="btn ${k === _category ? 'btn-primary' : 'btn-secondary'} btn-sm" data-cat="${k}">${escapeHtml(l)}</button>`).join('')}
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar__filters">
        <div class="search-box">
          ${icon('search')}
          <input type="text" id="ip-f-q" placeholder="Buscar IP..." value="${escapeHtml(_q)}">
        </div>
        <input type="text" id="ip-quick-add" placeholder="Agregar IP manualmente (ej. 190.12.34.56)" style="min-width:220px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px">
        <button class="btn btn-danger btn-sm" id="ip-quick-block">${icon('shield')} Bloquear</button>
        <button class="btn btn-secondary btn-sm" id="ip-quick-authorize">${icon('check-circle')} Autorizar</button>
      </div>
    </div>
    <div id="ip-list"></div>
  `;

  container.querySelectorAll('#ip-tabs [data-cat]').forEach(btn => {
    btn.addEventListener('click', () => { _category = btn.dataset.cat; renderIp(); });
  });
  document.getElementById('ip-f-q').addEventListener('input', e => {
    clearTimeout(_qDebounce);
    const v = e.target.value;
    _qDebounce = setTimeout(() => { _q = v; load(); }, 350);
  });
  document.getElementById('ip-quick-block').addEventListener('click', () => {
    const ip = document.getElementById('ip-quick-add').value.trim();
    if (!ip) { toast('Escribe una dirección IP primero', 'error'); return; }
    blockIp(ip);
  });
  document.getElementById('ip-quick-authorize').addEventListener('click', () => {
    const ip = document.getElementById('ip-quick-add').value.trim();
    if (!ip) { toast('Escribe una dirección IP primero', 'error'); return; }
    authorizeIp(ip);
  });

  load();
}

async function load() {
  const list = document.getElementById('ip-list');
  try {
    const data = await Store.getIps({ category: _category, q: _q || undefined });
    _rows = data.rows;
    renderList();
  } catch (err) {
    if (list) list.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p>${escapeHtml(err.message || 'Error al cargar las IP')}</p></div></div>`;
  }
}

function renderList() {
  const list = document.getElementById('ip-list');
  if (!list) return;
  if (_rows.length === 0) {
    list.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('globe')}<p><strong>Sin IP en esta categoría</strong></p></div></div>`;
    return;
  }
  list.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>IP</th><th>Motivo</th><th>Intentos</th><th>Última actividad</th><th>Actualizado</th><th></th></tr></thead>
        <tbody>
          ${_rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;

  list.querySelectorAll('[data-authorize]').forEach(b => b.addEventListener('click', () => authorizeIp(b.dataset.authorize)));
  list.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => blockIp(b.dataset.block)));
  list.querySelectorAll('[data-suspicious]').forEach(b => b.addEventListener('click', () => markSuspicious(b.dataset.suspicious)));
  list.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => resetIp(b.dataset.reset)));
}

function rowHtml(r) {
  const extra = r.category === 'bloqueada'
    ? (r.is_permanent ? ' · bloqueo permanente' : r.blocked_until ? ` · hasta ${formatDateTime(r.blocked_until)}` : '')
    : '';
  return `
  <tr>
    <td class="cell-main">${escapeHtml(r.ip)}</td>
    <td class="cell-sub">${escapeHtml(r.reason || '—')}</td>
    <td class="cell-sub">${r.attempt_count} (${r.failed_count} fallidos)</td>
    <td class="cell-sub">${r.last_seen ? formatDateTime(r.last_seen) : '—'}</td>
    <td class="cell-sub">${formatDateTime(r.updated_at)}${r.updated_by_username ? ' · ' + escapeHtml(r.updated_by_username) : ''}${extra}</td>
    <td style="white-space:nowrap">
      ${r.category !== 'autorizada' ? `<button class="btn btn-secondary btn-sm" data-authorize="${escapeHtml(r.ip)}">${icon('check-circle')}</button>` : ''}
      ${r.category !== 'bloqueada' ? `<button class="btn btn-danger btn-sm" data-block="${escapeHtml(r.ip)}">${icon('shield')}</button>` : ''}
      ${r.category !== 'sospechosa' ? `<button class="btn btn-secondary btn-sm" data-suspicious="${escapeHtml(r.ip)}">${icon('alert-triangle')}</button>` : ''}
      ${r.category !== 'observacion' ? `<button class="btn btn-secondary btn-sm" data-reset="${escapeHtml(r.ip)}">${icon('eye')}</button>` : ''}
    </td>
  </tr>`;
}

async function updateIp(ip, category, extra) {
  try {
    await Store.updateIp(ip, { category, ...extra });
    toast(`${ip} → ${CATEGORY_LABEL[category]}`, 'success');
    load();
  } catch (err) { toast(err.message || 'No se pudo actualizar', 'error'); }
}

function blockIp(ip) {
  const reason = window.prompt('Motivo del bloqueo:', '');
  if (reason === null) return;
  const perm = window.confirm('¿Bloqueo permanente?\n\nAceptar = permanente\nCancelar = temporal (24 horas)');
  const extra = perm
    ? { is_permanent: true, reason }
    : { is_permanent: false, reason, blocked_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
  updateIp(ip, 'bloqueada', extra);
}
function authorizeIp(ip) {
  const reason = window.prompt('Motivo de la autorización (opcional):', '');
  if (reason === null) return;
  updateIp(ip, 'autorizada', { reason });
}
function markSuspicious(ip) {
  const reason = window.prompt('Motivo (opcional):', '');
  if (reason === null) return;
  updateIp(ip, 'sospechosa', { reason });
}
function resetIp(ip) {
  updateIp(ip, 'observacion', { reason: null });
}
