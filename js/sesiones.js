import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime, formatDateTimeSec } from './utils.js';
import { confirmDialog, toast } from './ui.js';

let _all = [];       // una fila por usuario (su sesión más reciente)
let _countByUser = new Map(); // usuario_id -> cantidad total de sesiones activas (todas las áreas)
let _filters = { q: '', area: '' };
let _expanded = null;      // usuario_id actualmente expandido, o null
let _historyCache = new Map(); // username -> rows (evita repetir la consulta al reabrir)
let _historyDays = 30;

const AREA_LABEL_BY_PATH = {
  ti: 'TI', adg: 'ADG', rrhh: 'RR. HH.', soporte: 'Soporte',
  security: 'DST · Seguridad', audit: 'Auditoría', auth: 'Autenticación',
};

function friendlyPage(path) {
  if (!path) return 'Sin actividad registrada';
  const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const area = AREA_LABEL_BY_PATH[segments[0]] || segments[0] || '';
  const resource = segments[1] || '';
  return resource ? `${area} · ${resource}` : area;
}

export function renderSesiones() {
  const container = document.getElementById('view-sesiones');
  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__filters">
        <div class="search-box">
          ${icon('search')}
          <input type="text" id="ses-f-q" placeholder="Buscar por nombre o usuario..." value="${escapeHtml(_filters.q)}">
        </div>
        <select id="ses-f-area">
          <option value="">Todas las áreas</option>
        </select>
      </div>
    </div>
    <div id="ses-table-wrap"><div class="empty-state"><p>Cargando sesiones…</p></div></div>
  `;
  document.getElementById('ses-f-q').addEventListener('input', e => {
    _filters.q = e.target.value;
    renderTable();
  });
  document.getElementById('ses-f-area').addEventListener('change', e => {
    _filters.area = e.target.value;
    renderTable();
  });
  load();
}

async function load() {
  try {
    const data = await Store.getSessions();
    // Una fila por usuario: la de mayor created_at (backend ya ordena DESC).
    // Cada panel (TI/ADG/RRHH/Soporte/DST) genera su propia fila en
    // `sesiones` al entrar — una persona puede tener varias sesiones
    // activas al mismo tiempo sin tener varias pestañas abiertas ahora
    // mismo, así que se cuenta el total real por usuario para poder
    // ofrecer "cerrar todas" cuando corresponde.
    const seen = new Set();
    _all = [];
    _countByUser = new Map();
    for (const s of data.rows) {
      _countByUser.set(s.usuario_id, (_countByUser.get(s.usuario_id) || 0) + 1);
      if (seen.has(s.usuario_id)) continue;
      seen.add(s.usuario_id);
      _all.push(s);
    }
    populateAreaFilter();
    renderTable();
  } catch (err) {
    document.getElementById('ses-table-wrap').innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p>${escapeHtml(err.message || 'Error al cargar sesiones')}</p></div></div>`;
  }
}

function populateAreaFilter() {
  const sel = document.getElementById('ses-f-area');
  if (!sel) return;
  const areas = [...new Set(_all.map(s => s.area).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todas las áreas</option>` + areas.map(a => `<option value="${escapeHtml(a)}" ${_filters.area === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('');
}

function filteredRows() {
  const q = _filters.q.trim().toLowerCase();
  return _all.filter(s => {
    if (_filters.area && s.area !== _filters.area) return false;
    if (!q) return true;
    const haystack = `${s.nombre} ${s.apellidos || ''} ${s.username}`.toLowerCase();
    return haystack.includes(q);
  });
}

function renderTable() {
  const wrap = document.getElementById('ses-table-wrap');
  if (!wrap) return;
  const rows = filteredRows();
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('clock')}<p><strong>Sin sesiones activas</strong></p></div></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Usuario</th><th>IP</th><th>Dispositivo</th><th>Inicio</th><th>Última actividad</th><th>Expira</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('[data-toggle-history]').forEach(el => {
    el.addEventListener('click', () => toggleHistory(el.dataset.toggleHistory, el.dataset.username));
  });
  wrap.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); revoke(Number(btn.dataset.revoke)); });
  });
  wrap.querySelectorAll('[data-revoke-all]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      revokeAll(Number(btn.dataset.revokeAll), btn.dataset.username, Number(btn.dataset.count));
    });
  });
  wireHistoryDaysSelect();
}

function rowHtml(s) {
  const isOpen = _expanded === s.usuario_id;
  const total = _countByUser.get(s.usuario_id) || 1;
  return `
  <tr>
    <td class="cell-main ses-user-cell" data-toggle-history="${s.usuario_id}" data-username="${escapeHtml(s.username)}" title="Ver historial de logeo por día">
      <span class="ses-chevron ${isOpen ? 'open' : ''}">▸</span>
      ${escapeHtml(`${s.nombre} ${s.apellidos || ''}`.trim())} <span class="cell-sub">(${escapeHtml(s.username)})</span>
      ${total > 1 ? `<br><span style="font-size:11px;color:var(--text-muted)">${total} sesiones activas en distintos paneles</span>` : ''}
    </td>
    <td class="cell-sub">${escapeHtml(s.ip_address || '—')}</td>
    <td class="cell-sub" title="${escapeHtml(s.user_agent || '')}">${escapeHtml((s.user_agent || '—').slice(0, 40))}</td>
    <td class="cell-sub">${formatDateTime(s.created_at)}</td>
    <td class="cell-sub">
      ${s.ultima_actividad ? formatDateTime(s.ultima_actividad) : '—'}
      <br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(friendlyPage(s.ultima_pagina))}</span>
    </td>
    <td class="cell-sub">${formatDateTime(s.expires_at)}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-danger btn-sm" data-revoke="${s.id}">${icon('log-out')} Cerrar</button>
      ${total > 1 ? `<button class="btn btn-secondary btn-sm" data-revoke-all="${s.usuario_id}" data-username="${escapeHtml(s.username)}" data-count="${total}">Cerrar todas (${total})</button>` : ''}
    </td>
  </tr>
  ${isOpen ? `<tr class="ses-detail-row"><td colspan="7">${historyPanelHtml(s)}</td></tr>` : ''}
  `;
}

function toggleHistory(usuarioId, username) {
  const id = Number(usuarioId);
  _expanded = _expanded === id ? null : id;
  renderTable();
  if (_expanded === id) loadHistory(username);
}

function historyPanelHtml(session) {
  const cached = _historyCache.get(session.username);
  return `
    <div class="ses-history">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <strong style="font-size:12.5px">Historial de logeo por día — ${escapeHtml(session.username)}</strong>
        <select data-history-days="${escapeHtml(session.username)}" style="font-size:12px">
          <option value="7" ${_historyDays === 7 ? 'selected' : ''}>Últimos 7 días</option>
          <option value="30" ${_historyDays === 30 ? 'selected' : ''}>Últimos 30 días</option>
          <option value="90" ${_historyDays === 90 ? 'selected' : ''}>Últimos 90 días</option>
        </select>
      </div>
      <div id="ses-history-body">${cached ? historyRowsHtml(cached, session) : '<p style="font-size:12.5px;color:var(--text-muted)">Cargando historial…</p>'}</div>
    </div>`;
}

/* Por cada día, una tabla con las mismas columnas que la fila
   principal (IP, Dispositivo, Inicio, Última actividad, Expira) —
   "Última actividad" y "Expira" solo existen para la sesión que
   sigue activa ahora mismo (login_attempts no guarda el ciclo de vida
   de la sesión, y las sesiones cerradas/vencidas se borran de
   `sesiones`); el primer login exitoso encontrado —de más reciente a
   más antiguo— es esa sesión viva y se anota con esos datos reales,
   el resto queda marcado como sesión finalizada. */
function historyRowsHtml(rows, liveSession) {
  if (!rows.length) return `<p style="font-size:12.5px;color:var(--text-muted)">Sin registros de login en este rango.</p>`;
  let liveFound = false;

  return rows.map(r => {
    const eventos = r.eventos || [];
    const eventRows = eventos.map(ev => {
      const isLive = !liveFound && ev.success && ev.ip === liveSession.ip_address;
      if (isLive) liveFound = true;
      return `
        <tr>
          <td class="cell-sub">${escapeHtml(ev.ip || '—')}</td>
          <td class="cell-sub" title="${escapeHtml(ev.user_agent || '')}">${escapeHtml((ev.user_agent || '—').slice(0, 40))}</td>
          <td class="cell-sub">${formatDateTimeSec(ev.created_at)}</td>
          <td class="cell-sub">${isLive ? formatDateTime(liveSession.ultima_actividad) : (ev.success ? 'Sesión finalizada' : '—')}</td>
          <td class="cell-sub">${isLive ? formatDateTime(liveSession.expires_at) : '—'}</td>
          <td>${ev.success ? '<span class="badge badge-green">Éxito</span>' : '<span class="badge badge-red">Fallido</span>'}</td>
        </tr>`;
    }).join('');

    return `
      <div class="ses-history-day">
        <div class="ses-history-day__header">
          <strong>${new Date(r.dia).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>
          <span class="badge badge-green">${r.exitosos} exitosos</span>
          ${r.fallidos > 0 ? `<span class="badge badge-amber">${r.fallidos} fallidos</span>` : ''}
        </div>
        <table class="ses-history-table">
          <thead><tr><th>IP</th><th>Dispositivo</th><th>Inicio</th><th>Última actividad</th><th>Expira</th><th></th></tr></thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>`;
  }).join('');
}

async function loadHistory(username) {
  const liveSession = _all.find(s => s.username === username);
  if (_historyCache.has(username)) {
    const body = document.getElementById('ses-history-body');
    if (body) body.innerHTML = historyRowsHtml(_historyCache.get(username), liveSession);
    return;
  }
  try {
    const data = await Store.getLoginHistory(username, _historyDays);
    _historyCache.set(username, data.rows);
    const body = document.getElementById('ses-history-body');
    if (body) body.innerHTML = historyRowsHtml(data.rows, liveSession);
  } catch (err) {
    const body = document.getElementById('ses-history-body');
    if (body) body.innerHTML = `<p style="font-size:12.5px;color:var(--danger)">${escapeHtml(err.message || 'No se pudo cargar el historial')}</p>`;
  }
}

function wireHistoryDaysSelect() {
  document.querySelectorAll('[data-history-days]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const username = sel.dataset.historyDays;
      _historyDays = Number(e.target.value);
      _historyCache.delete(username);
      const body = document.getElementById('ses-history-body');
      if (body) body.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Cargando historial…</p>';
      loadHistory(username);
    });
  });
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

async function revokeAll(usuarioId, username, count) {
  const ok = await confirmDialog(`¿Confirmas cerrar las ${count} sesiones activas de ${escapeHtml(username)} en todas las áreas? Quedará desconectado de todos los paneles donde tenga sesión abierta.`, { title: 'Cerrar todas las sesiones', confirmLabel: 'Cerrar todas' });
  if (!ok) return;
  try {
    await Store.revokeAllSessions(usuarioId);
    toast('Sesiones cerradas en todas las áreas', 'success');
    load();
  } catch (err) { toast(err.message || 'No se pudieron cerrar las sesiones', 'error'); }
}
