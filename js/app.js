import { renderDashboard } from './dashboard.js';
import { renderVisitas } from './visitas.js';
import { renderUsuarios } from './usuarios.js';
import { renderPermisos } from './permisos.js';
import { renderSesiones } from './sesiones.js';
import { renderIp } from './ip.js';
import { renderAuditoria } from './auditoria.js';

const VIEWS = {
  dashboard: { render: renderDashboard, title: 'Dashboard', subtitle: 'Resumen de seguridad del ecosistema Qubira' },
  visitas: { render: renderVisitas, title: 'Visitas', subtitle: 'Cómo interactúan los visitantes con el sitio público de QUBIRA' },
  usuarios: { render: renderUsuarios, title: 'Usuarios', subtitle: 'Cuentas del sistema, estado y accesos' },
  permisos: { render: renderPermisos, title: 'Permisos', subtitle: 'Módulos otorgados por usuario, más allá de su área' },
  sesiones: { render: renderSesiones, title: 'Sesiones', subtitle: 'Sesiones activas en todos los paneles de Qubira' },
  ip: { render: renderIp, title: 'IP', subtitle: 'Observación, bloqueo y autorización de direcciones IP' },
  auditoria: { render: renderAuditoria, title: 'Auditoría', subtitle: 'Registro de movimientos de todo el ecosistema Qubira' },
};

function renderView(name) {
  if (!VIEWS[name]) name = 'dashboard';

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === name);
  });

  document.getElementById('topbar-title').textContent = VIEWS[name].title;
  document.getElementById('topbar-subtitle').textContent = VIEWS[name].subtitle;

  VIEWS[name].render();
  closeSidebarOnMobile();
}

function closeSidebarOnMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => renderView(item.dataset.view));
  });

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('active');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebarOnMobile);
}

function renderSession() {
  const raw = localStorage.getItem('dst_user');
  if (!raw) return;
  try {
    const user = JSON.parse(raw);
    const nombre = `${user.nombre || ''} ${user.apellidos || ''}`.trim() || user.username;
    const iniciales = (user.nombre?.[0] || user.username?.[0] || '?').toUpperCase() + (user.apellidos?.[0] || '').toUpperCase();
    const nameEl = document.getElementById('session-name');
    const roleEl = document.getElementById('session-role');
    const avatarEl = document.getElementById('session-avatar');
    if (nameEl) nameEl.textContent = nombre;
    if (roleEl) roleEl.textContent = `${user.rol || 'DST'} · Qubira`;
    if (avatarEl) avatarEl.textContent = iniciales;
  } catch (_) { /* si el user guardado esta corrupto, se deja el placeholder */ }
}

async function logout() {
  try {
    await fetch(
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:4000' : 'https://api-qubira.onrender.com') + '/api/auth/logout',
      { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('dst_token') } }
    );
  } catch (_) { /* si ya estaba vencido igual cerramos local */ }
  localStorage.removeItem('dst_token');
  localStorage.removeItem('dst_user');
  window.location.href = 'login.html';
}

const CENTRAL_MODULO_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:5515/modulo.html'
  : 'https://qubira-login.vercel.app/modulo.html';
function switchModule() { window.location.href = CENTRAL_MODULO_URL; }

function showBootError() {
  const main = document.querySelector('.main');
  if (main) {
    main.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;text-align:center;padding:20px">
        <strong style="font-size:18px">No se pudo conectar con la API</strong>
        <p style="color:var(--text-muted);max-width:420px">Verifica tu conexión e intenta de nuevo. Si el problema persiste, contacta a soporte técnico.</p>
        <button class="btn btn-primary" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
}

function isAuthorized(user) {
  return (user?.authorized_modules || []).includes('DST');
}

(async function init() {
  /* Gate de acceso: se revalida en el cliente (defensa en profundidad)
     que la cuenta tenga el módulo DST autorizado — el backend igual
     rechaza con 403 cualquier endpoint /api/security/* si esto
     llegara a fallar. */
  if (!localStorage.getItem('dst_token')) {
    window.location.href = 'login.html';
    return;
  }
  try {
    const storedUser = JSON.parse(localStorage.getItem('dst_user') || 'null');
    if (!isAuthorized(storedUser)) {
      localStorage.removeItem('dst_token');
      localStorage.removeItem('dst_user');
      window.location.href = 'login.html';
      return;
    }
  } catch (_) { window.location.href = 'login.html'; return; }

  renderSession();
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('switch-module-btn')?.addEventListener('click', switchModule);

  initNav();
  try {
    renderView('dashboard');
  } catch (err) {
    if (err?.message !== 'SESSION_EXPIRED') showBootError();
  }
})();

// ─── Cierre de sesión por inactividad (2 minutos sin interacción) ─────────────
(function setupInactivityLogout(onLogout) {
  const WARN_AFTER_MS = 90 * 1000;
  const LOGOUT_AFTER_MS = 120 * 1000;
  let warnTimer = null;
  let logoutTimer = null;
  let countdownInterval = null;
  let overlay = null;

  function hideWarning() {
    if (overlay) { overlay.remove(); overlay = null; }
    clearInterval(countdownInterval);
  }

  function doLogout() {
    hideWarning();
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    onLogout();
  }

  function showWarning() {
    if (overlay) return;
    let secondsLeft = Math.round((LOGOUT_AFTER_MS - WARN_AFTER_MS) / 1000);
    overlay = document.createElement('div');
    overlay.id = 'inactivity-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.6);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:inherit';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;max-width:340px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.25)">
        <div style="width:48px;height:48px;border-radius:50%;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px">⏱</div>
        <h3 style="font-size:16px;font-weight:800;margin:0 0 8px;color:#111827">¿Sigues ahí?</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5">Tu sesión se cerrará por inactividad en <strong id="inactivity-countdown">${secondsLeft}</strong> segundos.</p>
        <button id="inactivity-stay-btn" style="width:100%;padding:12px;border:none;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">Seguir conectado</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('inactivity-stay-btn').addEventListener('click', resetTimers);
    countdownInterval = setInterval(() => {
      secondsLeft -= 1;
      const el = document.getElementById('inactivity-countdown');
      if (el) el.textContent = String(Math.max(secondsLeft, 0));
      if (secondsLeft <= 0) clearInterval(countdownInterval);
    }, 1000);
  }

  function resetTimers() {
    hideWarning();
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    if (!localStorage.getItem('dst_token')) return; // sin sesión activa, no hay nada que expirar
    warnTimer = setTimeout(showWarning, WARN_AFTER_MS);
    logoutTimer = setTimeout(doLogout, LOGOUT_AFTER_MS);
  }

  let lastActivity = 0;
  function handleActivity() {
    if (!localStorage.getItem('dst_token')) return;
    const now = Date.now();
    if (now - lastActivity < 500) return;
    lastActivity = now;
    resetTimers();
  }

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt =>
    document.addEventListener(evt, handleActivity, { passive: true }));

  /* Arranca el conteo apenas carga la página, no recién en la primera
     interacción — si no, alguien que deja la pestaña abierta sin
     tocar nada JAMÁS se desloguea (nunca dispara un evento). */
  resetTimers();
})(logout);
