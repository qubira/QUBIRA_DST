import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { confirmDialog, toast } from './ui.js';

let _rows = [];

export function renderSesiones() {
  const container = document.getElementById('view-sesiones');
  container.innerHTML = `<div id="ses-table-wrap"><div class="empty-state"><p>Cargando sesiones…</p></div></div>`;
  load();
}

async function load() {
  try {
    const data = await Store.getSessions();
    _rows = data.rows;
    renderTable();
  } catch (err) {
    document.getElementById('ses-table-wrap').innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p>${escapeHtml(err.message || 'Error al cargar sesiones')}</p></div></div>`;
  }
}

/* Agrupa por usuario (el backend ya devuelve las filas ordenadas por
   created_at DESC, así que el primer encuentro de cada usuario_id fija
   el orden del grupo, y las sesiones dentro del grupo quedan
   naturalmente de más reciente a más antigua). Evita repetir el
   nombre en cada fila cuando una persona tiene varias sesiones
   abiertas (ej. varios dispositivos). */
function groupByUser(rows) {
  const groups = new Map();
  for (const s of rows) {
    if (!groups.has(s.usuario_id)) groups.set(s.usuario_id, []);
    groups.get(s.usuario_id).push(s);
  }
  return [...groups.values()];
}

function renderTable() {
  const wrap = document.getElementById('ses-table-wrap');
  if (_rows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('clock')}<p><strong>Sin sesiones activas</strong></p></div></div>`;
    return;
  }
  wrap.innerHTML = groupByUser(_rows).map(groupHtml).join('');
  wrap.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', () => revoke(Number(btn.dataset.revoke)));
  });
}

function groupHtml(sessions) {
  const s0 = sessions[0];
  return `
  <details class="ses-group" open>
    <summary class="ses-group__summary">
      <span class="cell-main">${escapeHtml(`${s0.nombre} ${s0.apellidos || ''}`.trim())} <span class="cell-sub">(${escapeHtml(s0.username)})</span></span>
      <span class="badge badge-gray">${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}</span>
    </summary>
    <div class="table-wrap" style="margin-top:10px">
      <table>
        <thead>
          <tr><th>IP</th><th>Dispositivo</th><th>Inicio</th><th>Última actividad</th><th>Expira</th><th></th></tr>
        </thead>
        <tbody>
          ${sessions.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>
  </details>`;
}

function rowHtml(s) {
  return `
  <tr>
    <td class="cell-sub">${escapeHtml(s.ip_address || '—')}</td>
    <td class="cell-sub" title="${escapeHtml(s.user_agent || '')}">${escapeHtml((s.user_agent || '—').slice(0, 40))}</td>
    <td class="cell-sub">${formatDateTime(s.created_at)}</td>
    <td class="cell-sub">${s.ultima_actividad ? formatDateTime(s.ultima_actividad) : '—'}</td>
    <td class="cell-sub">${formatDateTime(s.expires_at)}</td>
    <td><button class="btn btn-danger btn-sm" data-revoke="${s.id}">${icon('log-out')} Cerrar</button></td>
  </tr>`;
}

async function revoke(sessionId) {
  const ok = await confirmDialog('¿Confirmas cerrar esta sesión? La persona quedará desconectada de inmediato en ese panel.', { title: 'Cerrar sesión', confirmLabel: 'Cerrar sesión' });
  if (!ok) return;
  try {
    await Store.revokeSession(sessionId);
    toast('Sesión cerrada', 'success');
    load();
  } catch (err) { toast(err.message || 'No se pudo cerrar la sesión', 'error'); }
}
