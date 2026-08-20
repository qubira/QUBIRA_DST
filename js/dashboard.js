import { Store } from './storage.js';
import { icon, escapeHtml } from './utils.js';

export async function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = `<div class="empty-state"><p>Cargando dashboard…</p></div>`;
  try {
    const d = await Store.getDashboard();
    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">Sesiones activas</div>
            <div class="kpi-card__value">${d.sesiones_activas}</div>
            <div class="kpi-card__hint">en todos los paneles</div>
          </div>
          <div class="kpi-card__icon blue">${icon('clock')}</div>
        </div>
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">Logins hoy</div>
            <div class="kpi-card__value">${d.logins_exitosos_hoy}</div>
            <div class="kpi-card__hint">${d.logins_fallidos_hoy} fallidos</div>
          </div>
          <div class="kpi-card__icon green">${icon('check-circle')}</div>
        </div>
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">Accesos denegados hoy</div>
            <div class="kpi-card__value">${d.accesos_denegados_hoy}</div>
            <div class="kpi-card__hint">respuestas 403</div>
          </div>
          <div class="kpi-card__icon amber">${icon('alert-triangle')}</div>
        </div>
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">Cuentas suspendidas</div>
            <div class="kpi-card__value">${d.cuentas_suspendidas}</div>
            <div class="kpi-card__hint">suspensión manual</div>
          </div>
          <div class="kpi-card__icon gray">${icon('lock')}</div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">IP sospechosas</div>
            <div class="kpi-card__value">${d.ip_sospechosas}</div>
            <div class="kpi-card__hint">requieren revisión</div>
          </div>
          <div class="kpi-card__icon amber">${icon('globe')}</div>
        </div>
        <div class="kpi-card">
          <div>
            <div class="kpi-card__label">IP bloqueadas</div>
            <div class="kpi-card__value">${d.ip_bloqueadas}</div>
            <div class="kpi-card__hint">acceso denegado por IP</div>
          </div>
          <div class="kpi-card__icon red">${icon('shield')}</div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p><strong>No se pudo cargar el dashboard</strong></p><p>${escapeHtml(err.message || '')}</p></div></div>`;
  }
}
