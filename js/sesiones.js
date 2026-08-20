import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime, formatDateTimeSec } from './utils.js';
import { confirmDialog, toast } from './ui.js';

let _all = [];       // una fila por usuario (su sesión más reciente)
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
    const seen = new Set();
    _all = [];
    for (const s of data.rows) {
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
  wireHistoryDaysSelect();
}

function rowHtml(s) {
  const isOpen = _expanded === s.usuario_id;
  return `
  <tr>
    <td class="cell-main ses-user-cell" data-toggle-history="${s.usuario_id}" data-username="${escapeHtml(s.username)}" title="Ver historial de logeo por día">
      <span class="ses-chevron ${isOpen ? 'open' : ''}">▸</span>
      ${escapeHtml(`${s.nombre} ${s.apellidos || ''}`.trim())} <span class="cell-sub">(${escapeHtml(s.username)})</span>
    </td>
    <td class="cell-sub">${escapeHtml(s.ip_address || '—')}</td>
    <td class="cell-sub" title="${escapeHtml(s.user_agent || '')}">${escapeHtml((s.user_agent || '—').slice(0, 40))}</td>
    <td class="cell-sub">${formatDateTime(s.created_at)}</td>
    <td class="cell-sub">
      ${s.ultima_actividad ? formatDateTime(s.ultima_actividad) : '—'}
      <br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(friendlyPage(s.ultima_pagina))}</span>
    </td>
    <td class="cell-sub">${formatDateTime(s.expires_at)}</td>
    <td><button class="btn btn-danger btn-sm" data-revoke="${s.id}">${icon('log-out')} Cerrar</button></td>
  </tr>
  ${isOpen ? `<tr class="ses-detail-row"><td colspan="7">${historyPanelHtml(s.username)}</td></tr>` : ''}
  `;
}

function toggleHistory(usuarioId, username) {
  const id = Number(usuarioId);
  _expanded = _expanded === id ? null : id;
  renderTable();
  if (_expanded === id) loadHistory(username);
}

function historyPanelHtml(username) {
  const cached = _historyCache.get(username);
  return `
    <div class="ses-history">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <strong style="font-size:12.5px">Historial de logeo por día — ${escapeHtml(username)}</strong>
        <select data-history-days="${escapeHtml(username)}" style="font-size:12px">
          <option value="7" ${_historyDays === 7 ? 'selected' : ''}>Últimos 7 días</option>
          <option value="30" ${_historyDays === 30 ? 'selected' : ''}>Últimos 30 días</option>
          <option value="90" ${_historyDays === 90 ? 'selected' : ''}>Últimos 90 días</option>
        </select>
      </div>
      <div id="ses-history-body">${cached ? historyRowsHtml(cached) : '<p style="font-size:12.5px;color:var(--text-muted)">Cargando historial…</p>'}</div>
    </div>`;
}

function historyRowsHtml(rows) {
  if (!rows.length) return `<p style="font-size:12.5px;color:var(--text-muted)">Sin registros de login en este rango.</p>`;
  return `
    <table class="ses-history-table">
      <thead><tr><th>Día</th><th>Exitosos</th><th>Fallidos</th><th>Detalle</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="cell-main">${new Date(r.dia).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
            <td>${r.fallidos > 0 && r.exitosos === 0 ? `<span class="badge badge-red">${r.exitosos}</span>` : `<span class="badge badge-green">${r.exitosos}</span>`}</td>
            <td>${r.fallidos > 0 ? `<span class="badge badge-amber">${r.fallidos}</span>` : '0'}</td>
            <td class="cell-sub">
              ${(r.eventos || []).slice(0, 5).map(ev => `${formatDateTimeSec(ev.created_at)} · ${escapeHtml(ev.ip || '—')} ${ev.success ? '✓' : '✕'}`).join('<br>')}
              ${r.eventos && r.eventos.length > 5 ? `<br>+${r.eventos.length - 5} más` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

async function loadHistory(username) {
  if (_historyCache.has(username)) return;
  try {
    const data = await Store.getLoginHistory(username, _historyDays);
    _historyCache.set(username, data.rows);
    const body = document.getElementById('ses-history-body');
    if (body) body.innerHTML = historyRowsHtml(data.rows);
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
