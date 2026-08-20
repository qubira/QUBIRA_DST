import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast, openModal, closeModal } from './ui.js';

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
  const modal = openModal({
    title: `Bloquear ${ip}`,
    size: 'sm',
    bodyHtml: `
      <form id="ip-block-form">
        <div class="field">
          <label>Motivo del bloqueo</label>
          <input type="text" name="reason" placeholder="Ej. fuerza bruta, IP conocida por abuso...">
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" name="permanent" id="ip-block-permanent" style="width:auto;">
          <label for="ip-block-permanent" style="margin:0;">Bloqueo permanente (si no, dura 24 horas)</label>
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn btn-danger" id="ip-block-confirm">${icon('shield')} Bloquear</button>
    `,
  });
  modal.querySelector('#ip-block-confirm').addEventListener('click', () => {
    const form = modal.querySelector('#ip-block-form');
    const fd = new FormData(form);
    const perm = fd.get('permanent') === 'on';
    const extra = perm
      ? { is_permanent: true, reason: fd.get('reason') }
      : { is_permanent: false, reason: fd.get('reason'), blocked_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
    closeModal();
    updateIp(ip, 'bloqueada', extra);
  });
}

function reasonModal({ title, confirmLabel, confirmClass = 'btn-primary', category, ip }) {
  const modal = openModal({
    title,
    size: 'sm',
    bodyHtml: `
      <form id="ip-reason-form">
        <div class="field">
          <label>Motivo (opcional)</label>
          <input type="text" name="reason">
        </div>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn ${confirmClass}" id="ip-reason-confirm">${confirmLabel}</button>
    `,
  });
  modal.querySelector('#ip-reason-confirm').addEventListener('click', () => {
    const fd = new FormData(modal.querySelector('#ip-reason-form'));
    closeModal();
    updateIp(ip, category, { reason: fd.get('reason') });
  });
}

function authorizeIp(ip) {
  reasonModal({ title: `Autorizar ${ip}`, confirmLabel: `${icon('check-circle')} Autorizar`, category: 'autorizada', ip });
}
function markSuspicious(ip) {
  reasonModal({ title: `Marcar ${ip} como sospechosa`, confirmLabel: `${icon('alert-triangle')} Marcar sospechosa`, confirmClass: 'btn-danger', category: 'sospechosa', ip });
}
function resetIp(ip) {
  updateIp(ip, 'observacion', { reason: null });
}
