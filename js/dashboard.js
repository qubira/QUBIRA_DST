import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime, formatDateTimeSec } from './utils.js';
import { confirmDialog, toast, openModal } from './ui.js';
import { groupedBarChart, singleBarChart, donutChart, DONUT_COLORS } from './charts.js';

export async function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = `<div class="empty-state"><p>Cargando dashboard…</p></div>`;
  try {
    const [d, threats] = await Promise.all([Store.getDashboard(), Store.getThreats()]);
    container.innerHTML = kpiHtml(d) + chartsHtml(d) + dbHealthHtml(d.db_health) + threatsShell();
    renderThreats(threats);
    wireThreats();
    wireKpiCards();
  } catch (err) {
    container.innerHTML = `<div class="table-wrap"><div class="empty-state">${icon('alert-triangle')}<p><strong>No se pudo cargar el dashboard</strong></p><p>${escapeHtml(err.message || '')}</p></div></div>`;
  }
}

function kpiHtml(d) {
  return `
    <div class="kpi-grid">
      <div class="kpi-card clickable" data-kpi="sesiones_activas">
        <div>
          <div class="kpi-card__label">Sesiones activas</div>
          <div class="kpi-card__value">${d.sesiones_activas}</div>
          <div class="kpi-card__hint">en todos los paneles</div>
        </div>
        <div class="kpi-card__icon blue">${icon('clock')}</div>
      </div>
      <div class="kpi-card clickable" data-kpi="logins_hoy">
        <div>
          <div class="kpi-card__label">Logins hoy</div>
          <div class="kpi-card__value">${d.logins_exitosos_hoy}</div>
          <div class="kpi-card__hint">${d.logins_fallidos_hoy} fallidos</div>
        </div>
        <div class="kpi-card__icon green">${icon('check-circle')}</div>
      </div>
      <div class="kpi-card clickable" data-kpi="accesos_denegados">
        <div>
          <div class="kpi-card__label">Accesos denegados hoy</div>
          <div class="kpi-card__value">${d.accesos_denegados_hoy}</div>
          <div class="kpi-card__hint">respuestas 403</div>
        </div>
        <div class="kpi-card__icon amber">${icon('alert-triangle')}</div>
      </div>
      <div class="kpi-card clickable" data-kpi="cuentas_suspendidas">
        <div>
          <div class="kpi-card__label">Cuentas suspendidas</div>
          <div class="kpi-card__value">${d.cuentas_suspendidas}</div>
          <div class="kpi-card__hint">suspensión manual</div>
        </div>
        <div class="kpi-card__icon gray">${icon('lock')}</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card clickable" data-kpi="ip_sospechosas">
        <div>
          <div class="kpi-card__label">IP sospechosas</div>
          <div class="kpi-card__value">${d.ip_sospechosas}</div>
          <div class="kpi-card__hint">requieren revisión</div>
        </div>
        <div class="kpi-card__icon amber">${icon('globe')}</div>
      </div>
      <div class="kpi-card clickable" data-kpi="ip_bloqueadas">
        <div>
          <div class="kpi-card__label">IP bloqueadas</div>
          <div class="kpi-card__value">${d.ip_bloqueadas}</div>
          <div class="kpi-card__hint">acceso denegado por IP</div>
        </div>
        <div class="kpi-card__icon red">${icon('shield')}</div>
      </div>
    </div>
  `;
}

const KPI_DETAIL_TITLES = {
  sesiones_activas: 'Sesiones activas',
  logins_hoy: 'Logins de hoy',
  accesos_denegados: 'Accesos denegados de hoy',
  cuentas_suspendidas: 'Cuentas suspendidas',
  ip_sospechosas: 'IP sospechosas',
  ip_bloqueadas: 'IP bloqueadas',
};

function wireKpiCards() {
  document.querySelectorAll('[data-kpi]').forEach(card => {
    card.addEventListener('click', () => openKpiDetail(card.dataset.kpi));
  });
}

async function openKpiDetail(kind) {
  const modal = openModal({ title: KPI_DETAIL_TITLES[kind] || 'Detalle', size: 'lg', bodyHtml: '<p style="font-size:12.5px;color:var(--text-muted)">Cargando…</p>' });
  const body = modal.querySelector('.modal__body');
  await refreshKpiDetail(kind, body);
}

async function refreshKpiDetail(kind, body) {
  try {
    body.innerHTML = await kpiDetailHtml(kind);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger);font-size:12.5px">${escapeHtml(err.message || 'No se pudo cargar el detalle')}</p>`;
    return;
  }
  body.querySelectorAll('[data-revoke-modal]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Confirmas cerrar esta sesión? La persona quedará desconectada de inmediato en ese panel.', { title: 'Cerrar sesión', confirmLabel: 'Cerrar sesión' });
      if (!ok) return;
      try {
        await Store.revokeSession(Number(btn.dataset.revokeModal));
        toast('Sesión cerrada', 'success');
        await refreshKpiDetail(kind, body);
        renderDashboard();
      } catch (err) { toast(err.message || 'No se pudo cerrar la sesión', 'error'); }
    });
  });
}

function detailTable(headers, rows, emptyMsg) {
  if (!rows.length) return `<p style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(emptyMsg)}</p>`;
  return `
    <div class="table-wrap" style="box-shadow:none;border:1px solid var(--border)">
      <table>
        <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

async function kpiDetailHtml(kind) {
  const today = new Date().toISOString().slice(0, 10);

  if (kind === 'sesiones_activas') {
    const data = await Store.getSessions();
    const seen = new Set();
    const rows = data.rows.filter(s => (seen.has(s.usuario_id) ? false : (seen.add(s.usuario_id), true)))
      .map(s => `<tr>
        <td class="cell-main">${escapeHtml(`${s.nombre} ${s.apellidos || ''}`.trim())} <span class="cell-sub">(${escapeHtml(s.username)})</span></td>
        <td class="cell-sub">${escapeHtml(s.area || '—')}</td>
        <td class="cell-sub">${escapeHtml(s.ip_address || '—')}</td>
        <td class="cell-sub">${s.ultima_actividad ? formatDateTime(s.ultima_actividad) : '—'}</td>
        <td><button class="btn btn-danger btn-sm" data-revoke-modal="${s.id}">${icon('log-out')} Cerrar</button></td>
      </tr>`);
    return detailTable(['Usuario', 'Área', 'IP', 'Última actividad', ''], rows, 'Sin sesiones activas.');
  }

  if (kind === 'logins_hoy') {
    const data = await Store.getLoginsToday();
    const rows = data.rows.map(r => `<tr>
      <td class="cell-main">${escapeHtml(r.username || '—')}</td>
      <td class="cell-sub">${escapeHtml(r.ip || '—')}</td>
      <td class="cell-sub" title="${escapeHtml(r.user_agent || '')}">${escapeHtml((r.user_agent || '—').slice(0, 30))}</td>
      <td class="cell-sub">${formatDateTimeSec(r.created_at)}</td>
      <td>${r.success ? '<span class="badge badge-green">Éxito</span>' : '<span class="badge badge-red">Fallido</span>'}</td>
    </tr>`);
    return detailTable(['Usuario', 'IP', 'Dispositivo', 'Hora', 'Resultado'], rows, 'Sin intentos de login hoy todavía.');
  }

  if (kind === 'accesos_denegados') {
    const data = await Store.getAuditLogs({ area: 'ALL', action_type: 'access_denied', date_from: today, date_to: today, limit: 100 });
    const rows = data.rows.map(r => `<tr>
      <td class="cell-main">${escapeHtml(r.user_name || r.username || '—')}</td>
      <td class="cell-sub">${escapeHtml(r.area || '—')}</td>
      <td class="cell-sub" title="${escapeHtml(r.full_path || r.path)}">${escapeHtml(r.method)} ${escapeHtml((r.full_path || r.path || '').slice(0, 40))}</td>
      <td class="cell-sub">${formatDateTimeSec(r.created_at)}</td>
    </tr>`);
    return detailTable(['Usuario', 'Área', 'Ruta', 'Hora'], rows, 'Sin accesos denegados hoy.');
  }

  if (kind === 'cuentas_suspendidas') {
    const data = await Store.getUsers();
    const rows = data.rows.filter(u => u.suspendida_en).map(u => `<tr>
      <td class="cell-main">${escapeHtml(`${u.nombre} ${u.apellidos || ''}`.trim())} <span class="cell-sub">(${escapeHtml(u.username)})</span></td>
      <td class="cell-sub">${escapeHtml(u.suspendida_motivo || '—')}</td>
      <td class="cell-sub">${formatDateTime(u.suspendida_en)}</td>
    </tr>`);
    return detailTable(['Usuario', 'Motivo', 'Desde'], rows, 'Sin cuentas suspendidas.');
  }

  if (kind === 'ip_sospechosas' || kind === 'ip_bloqueadas') {
    const category = kind === 'ip_sospechosas' ? 'sospechosa' : 'bloqueada';
    const data = await Store.getIps({ category });
    const rows = data.rows.map(r => `<tr>
      <td class="cell-main">${escapeHtml(r.ip)}</td>
      <td class="cell-sub">${escapeHtml(r.reason || '—')}</td>
      <td class="cell-sub">${r.attempt_count} (${r.failed_count} fallidos)</td>
      <td class="cell-sub">${formatDateTime(r.updated_at)}</td>
    </tr>`);
    return detailTable(['IP', 'Motivo', 'Intentos', 'Actualizado'], rows, category === 'sospechosa' ? 'Sin IP sospechosas.' : 'Sin IP bloqueadas.');
  }

  return '<p style="font-size:12.5px;color:var(--text-muted)">Sin detalle disponible.</p>';
}

function chartsHtml(d) {
  const areas = d.sessions_by_area || [];
  const legend = areas.map((a, i) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)">
      <span style="width:9px;height:9px;border-radius:50%;background:${DONUT_COLORS[i % DONUT_COLORS.length]};display:inline-block"></span>
      ${escapeHtml(a.area)} (${a.n})
    </div>`).join('');

  return `
    <div class="panels-grid">
      <div class="card">
        <div class="card__header">
          <h3>Logins por día (14 días)</h3>
          <div style="display:flex;gap:12px;font-size:11.5px;color:var(--text-muted)">
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--success);margin-right:4px"></span>Exitosos</span>
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--danger);margin-right:4px"></span>Fallidos</span>
          </div>
        </div>
        <div class="card__body">
          ${groupedBarChart(d.logins_series || [], { keyA: 'exitosos', keyB: 'fallidos', colorA: 'var(--success)', colorB: 'var(--danger)' })}
        </div>
      </div>
      <div class="card">
        <div class="card__header"><h3>Sesiones activas por área</h3></div>
        <div class="card__body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          ${donutChart(areas.map(a => ({ label: a.area, value: a.n })), { colors: DONUT_COLORS })}
          <div style="display:flex;flex-direction:column;gap:6px">${legend || '<span style="font-size:12px;color:var(--text-muted)">Sin sesiones activas</span>'}</div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card__header"><h3>Accesos denegados por día (14 días)</h3></div>
      <div class="card__body" style="position:relative">
        ${accessDeniedTotal(d.access_denied_series) === 0
          ? '<p style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:12.5px">Sin accesos denegados en los últimos 14 días.</p>'
          : singleBarChart(d.access_denied_series || [], { key: 'total', color: 'var(--warning)' })}
      </div>
    </div>
  `;
}

function accessDeniedTotal(series) {
  return (series || []).reduce((sum, d) => sum + (d.total || 0), 0);
}

function dbHealthHtml(h) {
  if (!h) return '';
  const usedPct = h.pool_max ? Math.round((h.pool_total / h.pool_max) * 100) : 0;
  const pingClass = h.ping_ms < 150 ? 'badge-green' : h.ping_ms < 400 ? 'badge-amber' : 'badge-red';
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card__header">
        <h3>Salud de la base de datos</h3>
        <span class="badge ${pingClass}">${h.ping_ms} ms</span>
      </div>
      <div class="card__body">
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">
          Estado del pool de conexiones a Neon Postgres (ping en vivo + conexiones del proceso). No incluye métricas de cuenta de Neon (almacenamiento, cómputo) — eso requeriría agregar una API key de Neon, que hoy no existe en el proyecto.
        </p>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">Conexiones en uso</div>
            <div style="font-size:20px;font-weight:700">${h.pool_total} <span style="font-size:13px;font-weight:500;color:var(--text-muted)">/ ${h.pool_max}</span></div>
            <div style="width:140px;height:6px;border-radius:3px;background:var(--gray-bg);margin-top:6px;overflow:hidden">
              <div style="width:${usedPct}%;height:100%;background:${usedPct > 80 ? 'var(--danger)' : 'var(--primary)'}"></div>
            </div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">Inactivas</div>
            <div style="font-size:20px;font-weight:700">${h.pool_idle}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">En espera</div>
            <div style="font-size:20px;font-weight:700">${h.pool_waiting}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function threatsShell() {
  return `
    <div class="card">
      <div class="card__header"><h3>Amenazas recientes — fuerza bruta y bloqueos</h3></div>
      <div class="card__body" id="threats-body"><p style="font-size:12.5px;color:var(--text-muted)">Cargando…</p></div>
    </div>
  `;
}

function renderThreats(t) {
  const body = document.getElementById('threats-body');
  if (!body) return;
  const hasAny = (t.by_ip?.length || 0) + (t.by_username?.length || 0) + (t.locked_accounts?.length || 0) > 0;
  if (!hasAny) {
    body.innerHTML = `<div class="empty-state" style="padding:20px 10px">${icon('check-circle')}<p>Sin señales de fuerza bruta en la última hora, y ninguna cuenta bloqueada ahora mismo.</p></div>`;
    return;
  }

  body.innerHTML = `
    <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 12px">
      Umbral: ${t.threshold}+ intentos fallidos en ${t.window_minutes} minutos.
    </p>
    ${t.by_ip?.length ? `
      <h4 style="font-size:12.5px;margin:0 0 8px">IP con intentos fallidos repetidos</h4>
      <div class="mini-list" style="margin-bottom:16px">
        ${t.by_ip.map(r => `
          <div class="mini-row">
            <span style="font-size:12.5px">
              <strong>${escapeHtml(r.ip)}</strong> — ${r.fallidos} fallidos, contra ${escapeHtml((r.usernames || []).join(', ') || 'usuario desconocido')}
              <br><span style="color:var(--text-muted)">último intento ${formatDateTime(r.last_attempt)}</span>
            </span>
            <button class="btn btn-danger btn-sm" data-block-ip="${escapeHtml(r.ip)}">${icon('shield')} Bloquear IP</button>
          </div>
        `).join('')}
      </div>` : ''}
    ${t.by_username?.length ? `
      <h4 style="font-size:12.5px;margin:0 0 8px">Cuentas con intentos fallidos repetidos</h4>
      <div class="mini-list" style="margin-bottom:16px">
        ${t.by_username.map(r => `
          <div class="mini-row">
            <span style="font-size:12.5px">
              <strong>${escapeHtml(r.username)}</strong> — ${r.fallidos} fallidos, desde ${(r.ips || []).length} IP distinta(s)
              <br><span style="color:var(--text-muted)">último intento ${formatDateTime(r.last_attempt)}</span>
            </span>
          </div>
        `).join('')}
      </div>` : ''}
    ${t.locked_accounts?.length ? `
      <h4 style="font-size:12.5px;margin:0 0 8px">Cuentas bloqueadas automáticamente ahora mismo</h4>
      <div class="mini-list">
        ${t.locked_accounts.map(r => `
          <div class="mini-row">
            <span style="font-size:12.5px">
              <strong>${escapeHtml(`${r.nombre} ${r.apellidos || ''}`.trim())}</strong> (${escapeHtml(r.username)}) — ${r.intentos_fallidos} intentos
              <br><span style="color:var(--text-muted)">bloqueada hasta ${formatDateTime(r.bloqueada_hasta)}</span>
            </span>
            <button class="btn btn-secondary btn-sm" data-unlock="${r.id}">${icon('unlock')} Desbloquear</button>
          </div>
        `).join('')}
      </div>` : ''}
  `;
}

function wireThreats() {
  document.getElementById('threats-body')?.addEventListener('click', async (e) => {
    const blockBtn = e.target.closest('[data-block-ip]');
    const unlockBtn = e.target.closest('[data-unlock]');
    if (blockBtn) {
      const ip = blockBtn.dataset.blockIp;
      const ok = await confirmDialog(`¿Bloquear la IP ${escapeHtml(ip)} por 24 horas? Se detectó como posible fuerza bruta.`, { title: 'Bloquear IP', confirmLabel: 'Bloquear' });
      if (!ok) return;
      try {
        await Store.updateIp(ip, { category: 'bloqueada', reason: 'Fuerza bruta detectada automáticamente', is_permanent: false, blocked_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString() });
        toast('IP bloqueada', 'success');
        renderDashboard();
      } catch (err) { toast(err.message || 'No se pudo bloquear', 'error'); }
    } else if (unlockBtn) {
      const id = Number(unlockBtn.dataset.unlock);
      const ok = await confirmDialog('¿Desbloquear esta cuenta ahora? Podrá intentar iniciar sesión de nuevo de inmediato.', { title: 'Desbloquear cuenta', confirmLabel: 'Desbloquear', danger: false });
      if (!ok) return;
      try {
        await Store.unlockUser(id);
        toast('Cuenta desbloqueada', 'success');
        renderDashboard();
      } catch (err) { toast(err.message || 'No se pudo desbloquear', 'error'); }
    }
  });
}
