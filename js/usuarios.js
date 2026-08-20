import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { confirmDialog, toast } from './ui.js';
import { goToPermisos } from './permisos.js';

let _rows = [];
let _q = '';
let _qDebounce;

export function renderUsuarios() {
  const container = document.getElementById('view-usuarios');
  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__filters">
        <div class="search-box">
          ${icon('search')}
          <input type="text" id="usr-f-q" placeholder="Buscar por nombre, usuario o correo..." value="${escapeHtml(_q)}">
        </div>
      </div>
    </div>
    <div id="usr-table-wrap"><div class="empty-state"><p>Cargando usuarios…</p></div></div>
  `;
  document.getElementById('usr-f-q').addEventListener('input', e => {
    clearTimeout(_qDebounce);
    const v = e.target.value;
    _qDebounce = setTimeout(() => { _q = v; load(); }, 350);
  });
  load();
}

async function load() {
  try {
    const data = await Store.getUsers(_q);
    _rows = data.rows;
    renderTable();
  } catch (err) {
    document.getElementById('usr-table-wrap').innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p>${escapeHtml(err.message || 'Error al cargar usuarios')}</p></div></div>`;
  }
}

function estadoBadge(u) {
  if (u.suspendida_en) return `<span class="badge badge-red" title="${escapeHtml(u.suspendida_motivo || '')}">Suspendida</span>`;
  if (u.bloqueada_hasta && new Date(u.bloqueada_hasta) > new Date()) return `<span class="badge badge-amber">Bloqueada</span>`;
  if (u.estado !== 'activo') return `<span class="badge badge-gray">${escapeHtml(u.estado)}</span>`;
  return `<span class="badge badge-green">Activa</span>`;
}

function renderTable() {
  const wrap = document.getElementById('usr-table-wrap');
  if (_rows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('users')}<p><strong>Sin usuarios</strong></p></div></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Área</th><th>Módulos extra</th><th>Estado</th><th>Último acceso</th><th></th></tr>
        </thead>
        <tbody>
          ${_rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('[data-permisos]').forEach(btn => {
    btn.addEventListener('click', () => goToPermisos(Number(btn.dataset.permisos)));
  });
  wrap.querySelectorAll('[data-suspend]').forEach(btn => {
    btn.addEventListener('click', () => suspend(Number(btn.dataset.suspend)));
  });
  wrap.querySelectorAll('[data-unsuspend]').forEach(btn => {
    btn.addEventListener('click', () => unsuspend(Number(btn.dataset.unsuspend)));
  });
}

function rowHtml(u) {
  const modules = u.granted_modules || [];
  return `
  <tr>
    <td class="cell-main">${escapeHtml(`${u.nombre} ${u.apellidos || ''}`.trim())}</td>
    <td>${escapeHtml(u.username)}</td>
    <td><span class="tag">${escapeHtml(u.rol)}</span></td>
    <td class="cell-sub">${escapeHtml(u.area || '—')}</td>
    <td class="cell-sub">${modules.length ? modules.map(escapeHtml).join(', ') : '—'}</td>
    <td>${estadoBadge(u)}</td>
    <td class="cell-sub">${u.ultimo_login ? formatDateTime(u.ultimo_login) : '—'}${u.ultima_ip ? ' · ' + escapeHtml(u.ultima_ip) : ''}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-secondary btn-sm" data-permisos="${u.id}">${icon('key')} Permisos</button>
      ${u.suspendida_en
        ? `<button class="btn btn-secondary btn-sm" data-unsuspend="${u.id}">${icon('unlock')} Reactivar</button>`
        : `<button class="btn btn-danger btn-sm" data-suspend="${u.id}">${icon('lock')} Suspender</button>`}
    </td>
  </tr>`;
}

async function suspend(userId) {
  const motivo = window.prompt('Motivo de la suspensión:', '');
  if (motivo === null) return;
  if (!motivo.trim()) { toast('Escribe un motivo antes de suspender', 'error'); return; }
  const ok = await confirmDialog('¿Confirmas suspender esta cuenta? La persona no podrá iniciar sesión hasta que la reactives.', { title: 'Suspender cuenta', confirmLabel: 'Suspender' });
  if (!ok) return;
  try {
    await Store.suspendUser(userId, motivo.trim());
    toast('Cuenta suspendida', 'success');
    load();
  } catch (err) { toast(err.message || 'No se pudo suspender', 'error'); }
}

async function unsuspend(userId) {
  const ok = await confirmDialog('¿Confirmas reactivar esta cuenta?', { title: 'Reactivar cuenta', confirmLabel: 'Reactivar', danger: false });
  if (!ok) return;
  try {
    await Store.unsuspendUser(userId);
    toast('Cuenta reactivada', 'success');
    load();
  } catch (err) { toast(err.message || 'No se pudo reactivar', 'error'); }
}
