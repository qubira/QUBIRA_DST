import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast, confirmDialog } from './ui.js';

/* Regla de negocio: 3 códigos mal tolerados (el 4to ya bloquea 15
   min); si eso se repite 3 veces, la cuenta se suspende sola y solo
   DST la reactiva. Esta pestaña es el "resumen de observaciones" de
   cada cuenta para detectar si los bloqueos son reiterados — mezcla
   el estado actual (racha hacia la suspensión) con el historial de
   vida (que nunca se resetea) y el detalle de intentos/eventos. */

const EVENT_LABEL = {
  account_locked: 'Bloqueo temporal (15 min)',
  account_suspended: 'Suspensión',
  account_unsuspended: 'Reactivación',
  totp_enabled: 'Activó verificación en dos pasos',
  totp_disabled: 'Desactivó verificación en dos pasos',
  login: 'Inicio de sesión exitoso',
};

let _rows = [];
let _thresholds = { maxAttempts: 4, lockoutMinutes: 15, lockoutsBeforeSuspend: 3 };
let _selected = null;

export function renderBloqueos2fa() {
  const container = document.getElementById('view-bloqueos2fa');
  container.innerHTML = `
    <div class="panels-grid">
      <div class="card">
        <div class="card__header"><h3>Cuentas con bloqueos de 2FA</h3></div>
        <div class="card__body" style="padding:0">
          <div id="bq-list" style="padding:10px 8px 14px"><p style="padding:10px;color:var(--text-muted);font-size:13px">Cargando…</p></div>
        </div>
      </div>
      <div class="card">
        <div class="card__header"><h3 id="bq-selected-title">Selecciona una cuenta</h3></div>
        <div class="card__body" id="bq-detail">
          <div class="empty-state" style="padding:30px 10px;">${icon('shield')}<p>Elige una cuenta de la lista para ver su historial completo de bloqueos y suspensiones.</p></div>
        </div>
      </div>
    </div>
  `;
  load();
}

async function load() {
  try {
    const data = await Store.getTotpLockouts();
    _rows = data.rows || [];
    _thresholds = data.thresholds || _thresholds;
    renderList();
  } catch (err) {
    document.getElementById('bq-list').innerHTML = `<p style="padding:10px;color:var(--danger);font-size:13px">${escapeHtml(err.message || 'Error al cargar')}</p>`;
  }
}

function statusBadge(u) {
  if (u.suspendida_en) return `<span class="badge badge-red">Suspendida</span>`;
  if (u.bloqueada_hasta && new Date(u.bloqueada_hasta) > new Date()) return `<span class="badge badge-amber">Bloqueada</span>`;
  if (u.totp_lockout_count > 0) return `<span class="badge badge-amber">Racha activa (${u.totp_lockout_count}/${_thresholds.lockoutsBeforeSuspend})</span>`;
  return `<span class="badge badge-gray">Sin incidentes activos</span>`;
}

function renderList() {
  const list = document.getElementById('bq-list');
  if (!_rows.length) {
    list.innerHTML = `<p style="padding:10px;color:var(--text-muted);font-size:13px">Ninguna cuenta tiene historial de bloqueos por 2FA todavía.</p>`;
    return;
  }
  list.innerHTML = _rows.map(u => `
    <div class="mini-row" data-user="${u.id}" style="cursor:pointer;border-radius:8px;padding:8px 10px;${_selected?.id === u.id ? 'background:var(--primary-light)' : ''}">
      <span style="flex:1">
        <strong style="font-size:13px">${escapeHtml(`${u.nombre} ${u.apellidos || ''}`.trim())}</strong> ${statusBadge(u)}<br>
        <span style="font-size:11.5px;color:var(--text-muted)">
          ${escapeHtml(u.username)} · ${u.totp_lockout_total} bloqueo${u.totp_lockout_total === 1 ? '' : 's'} en total
          ${u.totp_auto_suspended_total ? ` · ${u.totp_auto_suspended_total} suspensión${u.totp_auto_suspended_total === 1 ? '' : 'es'} automática${u.totp_auto_suspended_total === 1 ? '' : 's'}` : ''}
        </span>
      </span>
    </div>
  `).join('');
  list.querySelectorAll('[data-user]').forEach(row => {
    row.addEventListener('click', () => {
      const u = _rows.find(x => x.id === Number(row.dataset.user));
      if (u) selectAccount(u);
    });
  });
}

async function selectAccount(user) {
  _selected = user;
  renderList();
  document.getElementById('bq-selected-title').textContent = `${user.nombre} ${user.apellidos || ''}`.trim();
  const detail = document.getElementById('bq-detail');
  detail.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Cargando historial…</p>`;
  try {
    const data = await Store.getTotpLockoutHistory(user.id);
    renderDetail(user, data.attempts || [], data.events || []);
  } catch (err) {
    detail.innerHTML = `<p style="color:var(--danger);font-size:13px">${escapeHtml(err.message || 'No se pudo cargar')}</p>`;
  }
}

function renderDetail(user, attempts, events) {
  const detail = document.getElementById('bq-detail');
  const isSuspended = !!user.suspendida_en;
  const isLocked = user.bloqueada_hasta && new Date(user.bloqueada_hasta) > new Date();
  const failedAttempts = attempts.filter(a => !a.success);

  detail.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div class="stat-mini"><strong>${user.totp_lockout_total}</strong><span>Bloqueos en total</span></div>
      <div class="stat-mini"><strong>${user.totp_auto_suspended_total}</strong><span>Suspensiones automáticas</span></div>
      <div class="stat-mini"><strong>${user.totp_lockout_count}/${_thresholds.lockoutsBeforeSuspend}</strong><span>Racha actual</span></div>
    </div>

    ${isSuspended ? `
      <div style="background:var(--danger-bg);border:1px solid var(--danger);border-radius:10px;padding:12px 14px;margin-bottom:16px">
        <strong style="color:var(--danger);display:flex;align-items:center;gap:6px">${icon('lock')} Cuenta suspendida</strong>
        <p style="font-size:12.5px;margin-top:6px">${escapeHtml(user.suspendida_motivo || 'Sin motivo registrado')}</p>
        <p style="font-size:11.5px;color:var(--text-muted);margin-top:4px">
          Desde ${formatDateTime(user.suspendida_en)}${user.suspendida_por_nombre ? ' · suspendida por ' + escapeHtml(user.suspendida_por_nombre) : ' · suspensión automática del sistema'}
        </p>
        <button class="btn btn-secondary btn-sm" id="bq-reactivar" style="margin-top:10px">${icon('unlock')} Reactivar cuenta</button>
      </div>
    ` : isLocked ? `
      <div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:10px;padding:12px 14px;margin-bottom:16px">
        <strong style="color:var(--warning);display:flex;align-items:center;gap:6px">${icon('clock')} Bloqueada temporalmente</strong>
        <p style="font-size:12.5px;margin-top:6px">Se desbloquea sola el ${formatDateTime(user.bloqueada_hasta)}, o puedes desbloquearla ahora desde Usuarios.</p>
      </div>
    ` : ''}

    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
      Regla vigente: ${_thresholds.maxAttempts - 1} códigos incorrectos se toleran, al ${_thresholds.maxAttempts}° se bloquea ${_thresholds.lockoutMinutes} min. Al acumular ${_thresholds.lockoutsBeforeSuspend} bloqueos seguidos sin un código correcto de por medio, la cuenta se suspende sola.
    </p>

    <h4 style="margin:18px 0 8px;font-size:13px;color:var(--text-muted)">Eventos de seguridad</h4>
    <div class="mini-list">${eventsHtml(events)}</div>

    <h4 style="margin:18px 0 8px;font-size:13px;color:var(--text-muted)">Últimos intentos de código (2FA y contraseña)</h4>
    <div class="mini-list">${attemptsHtml(attempts)}</div>
  `;

  document.getElementById('bq-reactivar')?.addEventListener('click', () => reactivar(user));
}

function eventsHtml(events) {
  if (!events.length) return `<p style="font-size:12.5px;color:var(--text-muted)">Sin eventos registrados.</p>`;
  return events.map(e => `
    <div class="mini-row" style="align-items:flex-start">
      <span style="font-size:12.5px">
        <strong>${escapeHtml(EVENT_LABEL[e.action_type] || e.action_type)}</strong><br>
        <span style="color:var(--text-muted)">${formatDateTime(e.created_at)}${e.ip ? ' · ' + escapeHtml(e.ip) : ''}</span>
      </span>
    </div>
  `).join('');
}

function attemptsHtml(attempts) {
  if (!attempts.length) return `<p style="font-size:12.5px;color:var(--text-muted)">Sin intentos registrados.</p>`;
  return attempts.slice(0, 20).map(a => `
    <div class="mini-row" style="align-items:flex-start">
      <span style="font-size:12.5px">
        <span class="badge ${a.success ? 'badge-green' : 'badge-red'}" style="margin-right:6px">${a.success ? 'Correcto' : 'Fallido'}</span>
        ${formatDateTime(a.created_at)}<br>
        <span style="color:var(--text-muted)">${a.ip ? escapeHtml(a.ip) : 'IP desconocida'}</span>
      </span>
    </div>
  `).join('');
}

async function reactivar(user) {
  const ok = await confirmDialog('¿Confirmas reactivar esta cuenta suspendida automáticamente por bloqueos de 2FA?', { title: 'Reactivar cuenta', confirmLabel: 'Reactivar', danger: false });
  if (!ok) return;
  try {
    await Store.unsuspendUser(user.id);
    toast('Cuenta reactivada', 'success');
    await load();
    const fresh = _rows.find(x => x.id === user.id);
    if (fresh) selectAccount(fresh);
    else {
      document.getElementById('bq-detail').innerHTML = `<div class="empty-state" style="padding:30px 10px;">${icon('shield')}<p>Esta cuenta ya no tiene incidentes activos.</p></div>`;
      document.getElementById('bq-selected-title').textContent = 'Selecciona una cuenta';
    }
  } catch (err) {
    toast(err.message || 'No se pudo reactivar', 'error');
  }
}
