import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast } from './ui.js';

const MODULES = [
  ['TI', 'TI'],
  ['ADG', 'ADG'],
  ['RRHH', 'RR. HH.'],
  ['SOPORTE', 'Soporte'],
  ['COMERCIAL', 'Comercial'],
];

let _users = [];
let _q = '';
let _qDebounce;
let _selected = null;
let _granted = new Set();
let _pendingUserId = null;

export function goToPermisos(userId) {
  _pendingUserId = userId;
  document.querySelector('.nav-item[data-view="permisos"]')?.click();
}

export function renderPermisos() {
  const container = document.getElementById('view-permisos');
  container.innerHTML = `
    <div class="panels-grid">
      <div class="card">
        <div class="card__header"><h3>Usuarios</h3></div>
        <div class="card__body" style="padding:0">
          <div style="padding:14px 18px 0">
            <div class="search-box">
              ${icon('search')}
              <input type="text" id="perm-f-q" placeholder="Buscar usuario..." value="${escapeHtml(_q)}">
            </div>
          </div>
          <div id="perm-user-list" style="padding:10px 8px 14px"><p style="padding:10px 10px;color:var(--text-muted);font-size:13px">Cargando…</p></div>
        </div>
      </div>
      <div class="card">
        <div class="card__header"><h3 id="perm-selected-title">Selecciona un usuario</h3></div>
        <div class="card__body" id="perm-editor">
          <div class="empty-state" style="padding:30px 10px;">${icon('key')}<p>Elige un usuario de la lista para ver y editar sus módulos.</p></div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('perm-f-q').addEventListener('input', e => {
    clearTimeout(_qDebounce);
    const v = e.target.value;
    _qDebounce = setTimeout(() => { _q = v; load(); }, 350);
  });
  load();
}

async function load() {
  try {
    const data = await Store.getUsers(_q);
    _users = data.rows;
    renderUserList();
    if (_pendingUserId) {
      const match = _users.find(u => u.id === _pendingUserId);
      _pendingUserId = null;
      if (match) selectUser(match);
    }
  } catch (err) {
    document.getElementById('perm-user-list').innerHTML = `<p style="padding:10px;color:var(--danger);font-size:13px">${escapeHtml(err.message || 'Error al cargar usuarios')}</p>`;
  }
}

function renderUserList() {
  const list = document.getElementById('perm-user-list');
  if (!list) return;
  if (_users.length === 0) {
    list.innerHTML = `<p style="padding:10px;color:var(--text-muted);font-size:13px">Sin resultados</p>`;
    return;
  }
  list.innerHTML = _users.map(u => `
    <div class="mini-row" data-user="${u.id}" style="cursor:pointer;border-radius:8px;padding:8px 10px;${_selected?.id === u.id ? 'background:var(--primary-light)' : ''}">
      <span>
        <strong style="font-size:13px">${escapeHtml(`${u.nombre} ${u.apellidos || ''}`.trim())}</strong><br>
        <span style="font-size:11.5px;color:var(--text-muted)">${escapeHtml(u.username)} · ${escapeHtml(u.area || 'sin área')}</span>
      </span>
    </div>
  `).join('');
  list.querySelectorAll('[data-user]').forEach(row => {
    row.addEventListener('click', () => {
      const u = _users.find(x => x.id === Number(row.dataset.user));
      if (u) selectUser(u);
    });
  });
}

async function selectUser(user) {
  _selected = user;
  renderUserList();
  document.getElementById('perm-selected-title').textContent = `${user.nombre} ${user.apellidos || ''}`.trim();
  const editor = document.getElementById('perm-editor');
  editor.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Cargando permisos…</p>`;
  try {
    const [permData, historyData] = await Promise.all([
      Store.getGrantedModules(user.id),
      Store.getPermissionHistory(user.id),
    ]);
    _granted = new Set(permData.granted || []);
    renderEditor(user, historyData.rows || []);
  } catch (err) {
    editor.innerHTML = `<p style="color:var(--danger);font-size:13px">${escapeHtml(err.message || 'No se pudo cargar')}</p>`;
  }
}

function renderEditor(user, history) {
  const editor = document.getElementById('perm-editor');
  const area = (user.area || '').toUpperCase();
  editor.innerHTML = `
    <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 10px">
      El módulo de su área (si tiene) se otorga automáticamente y no se puede quitar aquí. Los demás son adicionales.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${MODULES.map(([key, label]) => {
        const fromArea = key === area;
        const checked = fromArea || _granted.has(key);
        return `<span class="module-chip ${checked ? 'checked' : ''} ${fromArea ? 'from-area' : ''}" data-mod="${key}" title="${fromArea ? 'Otorgado automáticamente por su área' : ''}">
          ${checked ? icon('check-circle', 'icon') : ''} ${escapeHtml(label)}
        </span>`;
      }).join('')}
    </div>
    <button class="btn btn-primary btn-sm" id="perm-save">${icon('key')} Guardar cambios</button>

    <h4 style="margin:22px 0 8px;font-size:13px;color:var(--text-muted)">Historial de cambios</h4>
    <div id="perm-history">${historyHtml(history)}</div>
  `;

  editor.querySelectorAll('.module-chip:not(.from-area)').forEach(chip => {
    chip.addEventListener('click', () => {
      const mod = chip.dataset.mod;
      if (_granted.has(mod)) _granted.delete(mod); else _granted.add(mod);
      renderEditor(user, history);
    });
  });

  document.getElementById('perm-save').addEventListener('click', () => save(user));
}

function historyHtml(rows) {
  if (!rows.length) return `<p style="font-size:12.5px;color:var(--text-muted)">Sin cambios registrados todavía.</p>`;
  return `<div class="mini-list">${rows.map(r => `
    <div class="mini-row" style="align-items:flex-start">
      <span style="font-size:12.5px">
        <strong>${escapeHtml(r.admin_name || 'Admin')}</strong> cambió módulos: ${r.before.length ? escapeHtml(r.before.join(', ')) : '—'} → ${r.after.length ? escapeHtml(r.after.join(', ')) : '—'}<br>
        <span style="color:var(--text-muted)">${formatDateTime(r.created_at)}</span>
      </span>
    </div>
  `).join('')}</div>`;
}

async function save(user) {
  try {
    await Store.setGrantedModules(user.id, [..._granted]);
    toast('Permisos actualizados', 'success');
    selectUser(user);
  } catch (err) {
    toast(err.message || 'No se pudo guardar', 'error');
  }
}
