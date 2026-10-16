import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast, openModal, closeModal } from './ui.js';

let _rows = [];
let _stats = {
  total: 0,
  active_count: 0,
  inactive_count: 0,
  critical_inactive_count: 0,
  total_active_users: 0,
  active_users_with_2fa: 0,
  compliance_pct: 0,
};
let _filters = {
  q: '',
  totpStatus: 'inactive', // 'inactive' (default), 'all', 'active'
  area: '',
  roleLevel: 'all', // 'all', 'critical'
  accountStatus: 'all',
};
let _qDebounce = null;

export function renderCuentasSin2fa() {
  const container = document.getElementById('view-cuentas-sin-2fa');
  if (!container) return;

  container.innerHTML = `
    <!-- Banner de Política de Seguridad Corporativa -->
    <div style="background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:20px;box-shadow:0 4px 14px rgba(49,46,129,.2);display:flex;align-items:flex-start;gap:16px;">
      <div style="width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fde047;">
        ${icon('shield')}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
          <h3 style="font-size:15px;font-weight:800;letter-spacing:-.01em;margin:0;color:#fff;">Control de Seguridad y Cumplimiento 2FA Corporativo</h3>
          <span style="background:#eab308;color:#854d0e;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em;">Mandatorio</span>
        </div>
        <p style="font-size:12.5px;color:#e0e7ff;margin:0;line-height:1.5;">
          Por directriz del área de Seguridad Digital y Tráfico (DST), <strong>el 100% de las cuentas deben tener activa su verificación en dos pasos (2FA / TOTP)</strong> para acceder a los módulos de QUBIRA. Este reporte audita el cumplimiento en tiempo real y permite notificar a los usuarios en riesgo.
        </p>
      </div>
      <button class="btn btn-secondary" id="btn-comunicado-corp" style="background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.25);color:#fff;font-size:12px;white-space:nowrap;padding:7px 12px;">
        ${icon('message-circle')} Comunicado oficial
      </button>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:20px;">
      <div class="card" style="padding:16px 18px;border-left:4px solid #ef4444;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Cuentas sin 2FA</span>
          <span style="color:#ef4444">${icon('alert-triangle')}</span>
        </div>
        <div style="font-size:26px;font-weight:800;color:#ef4444;line-height:1.2;" id="kpi-inactive">-</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">Cuentas vulnerables sin TOTP</div>
      </div>

      <div class="card" style="padding:16px 18px;border-left:4px solid #f59e0b;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Roles Críticos sin 2FA</span>
          <span style="color:#f59e0b">${icon('key')}</span>
        </div>
        <div style="font-size:26px;font-weight:800;color:#f59e0b;line-height:1.2;" id="kpi-critical">-</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">Administradores o TI / DST en riesgo</div>
      </div>

      <div class="card" style="padding:16px 18px;border-left:4px solid #10b981;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Cuentas con 2FA</span>
          <span style="color:#10b981">${icon('check-circle')}</span>
        </div>
        <div style="font-size:26px;font-weight:800;color:#10b981;line-height:1.2;" id="kpi-active">-</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">Cuentas en cumplimiento seguro</div>
      </div>

      <div class="card" style="padding:16px 18px;border-left:4px solid var(--primary);position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11.5px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Adopción General</span>
          <span style="color:var(--primary)">${icon('activity')}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:8px;">
          <div style="font-size:26px;font-weight:800;color:var(--text);line-height:1.2;" id="kpi-pct">0%</div>
          <span style="font-size:11.5px;color:var(--text-muted);">de <strong id="kpi-total">-</strong> cuentas</span>
        </div>
        <div style="width:100%;background:#e5e7eb;height:6px;border-radius:999px;margin-top:8px;overflow:hidden;">
          <div id="kpi-progress-bar" style="width:0%;height:100%;background:var(--primary);transition:width .4s ease;"></div>
        </div>
      </div>
    </div>

    <!-- Barra de Filtros y Búsqueda -->
    <div class="toolbar" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div class="toolbar__filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;">
        <div class="search-box" style="min-width:240px;flex:1;max-width:340px;">
          ${icon('search')}
          <input type="text" id="f-search" placeholder="Buscar por nombre, usuario, correo..." value="${escapeHtml(_filters.q)}">
        </div>

        <select id="f-totp-status" class="filter-select" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:12.5px;background:#fff;font-family:inherit;cursor:pointer;">
          <option value="inactive" ${_filters.totpStatus === 'inactive' ? 'selected' : ''}>⚠️ Solo sin 2FA (Pendientes)</option>
          <option value="all" ${_filters.totpStatus === 'all' ? 'selected' : ''}>Todas las cuentas</option>
          <option value="active" ${_filters.totpStatus === 'active' ? 'selected' : ''}>✓ Solo con 2FA activo</option>
        </select>

        <select id="f-role-level" class="filter-select" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:12.5px;background:#fff;font-family:inherit;cursor:pointer;">
          <option value="all">Todos los roles</option>
          <option value="critical">👑 Solo roles críticos / directivos</option>
        </select>

        <select id="f-area" class="filter-select" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:12.5px;background:#fff;font-family:inherit;cursor:pointer;">
          <option value="">Todas las áreas</option>
        </select>
      </div>

      <div class="toolbar__actions" style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-secondary" id="btn-export-csv" title="Descargar reporte en formato CSV">
          ${icon('external-link')} Exportar CSV
        </button>
        <button class="btn btn-secondary" id="btn-refresh" title="Recargar datos">
          ${icon('clock')} Refrescar
        </button>
      </div>
    </div>

    <!-- Contenedor de la Tabla -->
    <div id="totp-table-wrap">
      <div class="empty-state"><p>Cargando reporte de seguridad 2FA…</p></div>
    </div>
  `;

  initEvents();
  loadData();
}

function initEvents() {
  const searchInput = document.getElementById('f-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      clearTimeout(_qDebounce);
      const val = e.target.value;
      _qDebounce = setTimeout(() => {
        _filters.q = val;
        renderFilteredTable();
      }, 250);
    });
  }

  const totpSelect = document.getElementById('f-totp-status');
  if (totpSelect) {
    totpSelect.addEventListener('change', e => {
      _filters.totpStatus = e.target.value;
      renderFilteredTable();
    });
  }

  const roleSelect = document.getElementById('f-role-level');
  if (roleSelect) {
    roleSelect.addEventListener('change', e => {
      _filters.roleLevel = e.target.value;
      renderFilteredTable();
    });
  }

  const areaSelect = document.getElementById('f-area');
  if (areaSelect) {
    areaSelect.addEventListener('change', e => {
      _filters.area = e.target.value;
      renderFilteredTable();
    });
  }

  document.getElementById('btn-refresh')?.addEventListener('click', loadData);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCsv);
  document.getElementById('btn-comunicado-corp')?.addEventListener('click', openComunicadoModal);
}

async function loadData() {
  const wrap = document.getElementById('totp-table-wrap');
  if (wrap) wrap.innerHTML = `<div class="empty-state"><p>Consultando base de datos corporativa…</p></div>`;

  try {
    let data;
    try {
      data = await Store.getTotpCompliance();
    } catch (_) {
      // Fallback automático si el backend aún no desplegó el nuevo endpoint
      const usersData = await Store.getUsers();
      const users = usersData.rows || [];
      const total = users.length;
      const active_count = users.filter(u => !!u.totp_enabled).length;
      const inactive_count = users.filter(u => !u.totp_enabled).length;
      const critical_inactive_count = users.filter(u => !u.totp_enabled && (u.nivel_acceso >= 50 || /admin|dst|ti/i.test(u.rol || ''))).length;
      data = {
        rows: users,
        stats: {
          total,
          active_count,
          inactive_count,
          critical_inactive_count,
          compliance_pct: total > 0 ? Math.round((active_count / total) * 100) : 0,
        }
      };
    }

    _rows = data.rows || [];
    _stats = data.stats || _stats;

    populateAreaOptions();
    updateKpis();
    updateSidebarCounter();
    renderFilteredTable();
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:40px 10px;">
          ${icon('alert-triangle')}
          <p style="color:var(--danger);font-weight:700;">Error al consultar el reporte de 2FA</p>
          <span style="font-size:12px;color:var(--text-muted);">${escapeHtml(err.message || 'Error de conexión')}</span>
        </div>
      `;
    }
  }
}

function updateKpis() {
  const elInactive = document.getElementById('kpi-inactive');
  const elCritical = document.getElementById('kpi-critical');
  const elActive = document.getElementById('kpi-active');
  const elPct = document.getElementById('kpi-pct');
  const elTotal = document.getElementById('kpi-total');
  const elBar = document.getElementById('kpi-progress-bar');

  if (elInactive) elInactive.textContent = _stats.inactive_count;
  if (elCritical) elCritical.textContent = _stats.critical_inactive_count;
  if (elActive) elActive.textContent = _stats.active_count;
  if (elTotal) elTotal.textContent = _stats.total;
  if (elPct) elPct.textContent = `${_stats.compliance_pct}%`;

  if (elBar) {
    elBar.style.width = `${Math.min(Math.max(_stats.compliance_pct, 0), 100)}%`;
    if (_stats.compliance_pct >= 85) elBar.style.background = '#10b981';
    else if (_stats.compliance_pct >= 50) elBar.style.background = '#f59e0b';
    else elBar.style.background = '#ef4444';
  }
}

function updateSidebarCounter() {
  const badge = document.getElementById('nav-sin-2fa-counter');
  if (badge) {
    if (_stats.inactive_count > 0) {
      badge.textContent = String(_stats.inactive_count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

function populateAreaOptions() {
  const select = document.getElementById('f-area');
  if (!select) return;

  const currentVal = _filters.area;
  const areas = [...new Set(_rows.map(r => r.area).filter(Boolean))].sort();

  select.innerHTML = '<option value="">Todas las áreas</option>' +
    areas.map(a => `<option value="${escapeHtml(a)}" ${currentVal === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('');
}

function getFilteredRows() {
  return _rows.filter(u => {
    // 2FA status
    if (_filters.totpStatus === 'inactive' && u.totp_enabled) return false;
    if (_filters.totpStatus === 'active' && !u.totp_enabled) return false;

    // Critical roles
    if (_filters.roleLevel === 'critical') {
      const isCritical = (u.nivel_acceso && u.nivel_acceso >= 50) || /admin|direct|dst|ti|geren/i.test(u.rol || '');
      if (!isCritical) return false;
    }

    // Area
    if (_filters.area && u.area !== _filters.area) return false;

    // Search query
    if (_filters.q) {
      const q = _filters.q.toLowerCase().trim();
      const name = `${u.nombre || ''} ${u.apellidos || ''}`.toLowerCase();
      const username = (u.username || '').toLowerCase();
      const correo = (u.correo || '').toLowerCase();
      const cargo = (u.rol || '').toLowerCase();
      if (!name.includes(q) && !username.includes(q) && !correo.includes(q) && !cargo.includes(q)) {
        return false;
      }
    }

    return true;
  });
}

function renderFilteredTable() {
  const wrap = document.getElementById('totp-table-wrap');
  if (!wrap) return;

  const filtered = getFilteredRows();

  if (filtered.length === 0) {
    if (_filters.totpStatus === 'inactive' && _stats.inactive_count === 0) {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:48px 16px;">
          <div style="width:52px;height:52px;border-radius:50%;background:#dcfce7;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:24px;">
            ${icon('check-circle')}
          </div>
          <p style="font-size:16px;font-weight:800;color:#166534;margin:0 0 6px;">¡Excelente! 100% de Cumplimiento 2FA</p>
          <span style="font-size:13px;color:var(--text-muted);">Todas las cuentas del sistema tienen su verificación en dos pasos activada.</span>
        </div>
      `;
    } else {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:40px 16px;">
          ${icon('search')}
          <p style="margin:8px 0 4px;font-weight:700;">No se encontraron colaboradores</p>
          <span style="font-size:12px;color:var(--text-muted);">Ajusta los filtros de búsqueda o categoría.</span>
        </div>
      `;
    }
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Rol & Nivel</th>
            <th>Área</th>
            <th>Estado Cuenta</th>
            <th>Estado 2FA</th>
            <th>Último Acceso / IP</th>
            <th style="text-align:right">Acciones de Control</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(u => renderRowHtml(u)).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#f9fafb;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);border-radius:0 0 12px 12px;">
      <span>Mostrando <strong>${filtered.length}</strong> cuenta${filtered.length === 1 ? '' : 's'} (${filtered.filter(x => !x.totp_enabled).length} sin 2FA)</span>
      <span>Política corporativa vigente DST · Qubira</span>
    </div>
  `;

  // Listeners para botones de acción
  wrap.querySelectorAll('[data-action="notify"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const user = _rows.find(x => x.id === id);
      if (user) openNotifyModal(user);
    });
  });

  wrap.querySelectorAll('[data-action="inspect"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const user = _rows.find(x => x.id === id);
      if (user) openInspectModal(user);
    });
  });
}

function renderRowHtml(u) {
  const nombreCompleto = `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.username;
  const iniciales = (u.nombre?.[0] || u.username?.[0] || '?').toUpperCase() + (u.apellidos?.[0] || '').toUpperCase();
  const isCritical = (u.nivel_acceso && u.nivel_acceso >= 50) || /admin|direct|dst|ti|geren/i.test(u.rol || '');

  let statusBadgeHtml = '<span class="badge badge-green">Activa</span>';
  if (u.suspendida_en) {
    statusBadgeHtml = `<span class="badge badge-red" title="${escapeHtml(u.suspendida_motivo || 'Suspendida')}">Suspendida</span>`;
  } else if (u.bloqueada_hasta && new Date(u.bloqueada_hasta) > new Date()) {
    statusBadgeHtml = '<span class="badge badge-amber">Bloqueada temporal</span>';
  } else if (u.estado && u.estado !== 'activo') {
    statusBadgeHtml = `<span class="badge badge-gray">${escapeHtml(u.estado)}</span>`;
  }

  let totpBadgeHtml = '';
  if (u.totp_enabled) {
    totpBadgeHtml = `
      <span class="badge badge-green" style="font-weight:700" title="${u.totp_enabled_at ? 'Activado el ' + formatDateTime(u.totp_enabled_at) : '2FA Activo'}">
        ✓ Activo
      </span>
    `;
  } else {
    totpBadgeHtml = `
      <span class="badge badge-red" style="font-weight:700">
        ⚠️ Pendiente / Sin 2FA
      </span>
    `;
  }

  return `
    <tr style="${!u.totp_enabled ? 'background:rgba(254, 242, 242, 0.35);' : ''}">
      <td>
        <div class="person-cell">
          <div class="avatar" style="${!u.totp_enabled ? 'background:#fee2e2;color:#991b1b;' : ''}">${escapeHtml(iniciales)}</div>
          <div>
            <strong style="color:var(--text);font-size:13.5px;">${escapeHtml(nombreCompleto)}</strong>
            <div style="font-size:11.5px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
              <span>@${escapeHtml(u.username)}</span>
              ${u.correo ? `<span>·</span><span>${escapeHtml(u.correo)}</span>` : ''}
            </div>
          </div>
        </div>
      </td>
      <td>
        <div style="font-weight:600;font-size:12.5px;color:#1f2937;">${escapeHtml(u.rol || 'Sin rol')}</div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:2px;">
          ${isCritical ? '<span class="tag" style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700;">👑 Nivel Crítico</span>' : `<span style="font-size:11px;color:var(--text-muted)">Nivel ${u.nivel_acceso || 10}</span>`}
        </div>
      </td>
      <td>
        <span style="font-size:12.5px;color:var(--text);font-weight:500;">${escapeHtml(u.area || 'Sin área')}</span>
      </td>
      <td>${statusBadgeHtml}</td>
      <td>${totpBadgeHtml}</td>
      <td>
        <div style="font-size:12px;color:var(--text);">
          ${u.ultimo_login ? formatDateTime(u.ultimo_login) : '<span style="color:var(--text-muted);font-style:italic">Nunca ha ingresado</span>'}
        </div>
        ${u.ultima_ip ? `<code style="font-size:11px;color:var(--text-muted);background:#f3f4f6;padding:1px 5px;border-radius:4px;">${escapeHtml(u.ultima_ip)}</code>` : ''}
      </td>
      <td style="text-align:right">
        <div style="display:inline-flex;gap:6px;">
          ${!u.totp_enabled ? `
            <button class="btn btn-secondary" data-action="notify" data-id="${u.id}" style="padding:5px 9px;font-size:11.5px;border-color:#fca5a5;color:#b91c1c;background:#fff;" title="Generar recordatorio para este colaborador">
              ${icon('bell')} Notificar
            </button>
          ` : ''}
          <button class="btn btn-secondary" data-action="inspect" data-id="${u.id}" style="padding:5px 9px;font-size:11.5px;" title="Ver detalles y permisos de la cuenta">
            ${icon('eye')} Detalle
          </button>
        </div>
      </td>
    </tr>
  `;
}

function openNotifyModal(user) {
  const nombre = `${user.nombre || ''} ${user.apellidos || ''}`.trim() || user.username;
  const mensajeDefault = `Hola ${nombre},

Desde el equipo de Seguridad Digital y Tráfico (DST) de QUBIRA, te recordamos que es OBLIGATORIO tener activada la Verificación en Dos Pasos (2FA) en tu cuenta corporativa (@${user.username}).

Para activarla en 1 minuto:
1. Inicia sesión en la plataforma de selección de módulos: https://qubira-login.vercel.app/modulo.html
2. Haz clic en el botón "Seguridad" en la esquina superior derecha.
3. Presiona "Activar verificación en dos pasos", escanea el código QR con tu app autenticadora (Google Authenticator o Authy) e introduce el código de 6 dígitos.

Agradecemos tu compromiso con la ciberseguridad corporativa.
— DST QUBIRA`;

  const content = `
    <div style="padding:22px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="width:40px;height:40px;border-radius:10px;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-size:20px;">
          ${icon('alert-triangle')}
        </div>
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800;">Aviso de Activación de 2FA</h3>
          <p style="margin:0;font-size:12px;color:var(--text-muted);">Colaborador: <strong>${escapeHtml(nombre)}</strong> (@${escapeHtml(user.username)})</p>
        </div>
      </div>

      <p style="font-size:12.5px;color:var(--text);margin-bottom:10px;line-height:1.5;">
        Copia este mensaje formal para enviárselo al colaborador mediante Slack, WhatsApp, correo corporativo o ticket:
      </p>

      <textarea id="modal-notify-text" rows="10" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:12px;font-family:inherit;font-size:12px;line-height:1.5;resize:vertical;background:#f9fafb;box-sizing:border-box;">${escapeHtml(mensajeDefault)}</textarea>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;">
        ${user.correo ? `
          <a href="mailto:${encodeURIComponent(user.correo)}?subject=${encodeURIComponent('AVISO DST: Activación obligatoria de 2FA en cuenta QUBIRA')}&body=${encodeURIComponent(mensajeDefault)}" class="btn btn-secondary" style="font-size:12px;gap:6px;display:inline-flex;align-items:center;" target="_blank">
            ${icon('external-link')} Enviar por correo
          </a>
        ` : '<div></div>'}
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" id="modal-notify-copy-btn">
            ${icon('edit')} Copiar texto
          </button>
          <button class="btn btn-primary" id="modal-notify-close-btn">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  `;

  openModal(content);

  document.getElementById('modal-notify-copy-btn')?.addEventListener('click', async () => {
    const text = document.getElementById('modal-notify-text').value;
    try {
      await navigator.clipboard.writeText(text);
      toast('Mensaje copiado al portapapeles');
    } catch (_) {
      document.getElementById('modal-notify-text').select();
      document.execCommand('copy');
      toast('Mensaje copiado al portapapeles');
    }
  });

  document.getElementById('modal-notify-close-btn')?.addEventListener('click', closeModal);
}

function openInspectModal(user) {
  const nombre = `${user.nombre || ''} ${user.apellidos || ''}`.trim() || user.username;
  const content = `
    <div style="padding:22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px;">
        <h3 style="margin:0;font-size:16px;font-weight:800;">Detalles de Cuenta y Seguridad</h3>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:12.5px;">
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">COLABORADOR</span>
          <strong>${escapeHtml(nombre)}</strong>
        </div>
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">NOMBRE DE USUARIO</span>
          <strong>@${escapeHtml(user.username)}</strong>
        </div>
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">CORREO ELECTRÓNICO</span>
          <span>${escapeHtml(user.correo || 'No registrado')}</span>
        </div>
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">ROL / NIVEL</span>
          <span>${escapeHtml(user.rol || 'Sin rol')} (Nivel ${user.nivel_acceso || 10})</span>
        </div>
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">ÁREA DE TRABAJO</span>
          <span>${escapeHtml(user.area || 'Sin área')}</span>
        </div>
        <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;">
          <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;">ESTADO DE 2FA</span>
          ${user.totp_enabled ? '<strong style="color:#15803d">✓ Activo</strong>' : '<strong style="color:#b91c1c">⚠️ Inactivo (Vulnerable)</strong>'}
        </div>
      </div>

      <div style="background:#f3f4f6;padding:10px 12px;border-radius:8px;margin-bottom:18px;font-size:12px;">
        <span style="color:var(--text-muted);display:block;font-size:11px;font-weight:700;margin-bottom:4px;">MÓDULOS ASIGNADOS</span>
        <span>${Array.isArray(user.granted_modules) && user.granted_modules.length ? user.granted_modules.map(m => `<span class="tag" style="margin-right:4px;">${escapeHtml(m)}</span>`).join('') : '<em style="color:var(--text-muted)">Solo los de su área</em>'}</span>
      </div>

      <div style="text-align:right;">
        <button class="btn btn-primary" id="modal-inspect-close">Entendido</button>
      </div>
    </div>
  `;

  openModal(content);
  document.getElementById('modal-inspect-close')?.addEventListener('click', closeModal);
}

function openComunicadoModal() {
  const comunicado = `COMUNICADO OFICIAL DE CIBERSEGURIDAD
DE: Dirección de Seguridad Digital y Tráfico (DST)
PARA: Todo el personal y usuarios del ecosistema QUBIRA
ASUNTO: Activación obligatoria de Verificación en Dos Pasos (2FA / TOTP)
FECHA: ${new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}

Estimado equipo QUBIRA,

En cumplimiento de las políticas de seguridad de la información corporativa y protección de datos, se reitera que TODAS las cuentas de usuario deben contar con la Verificación en Dos Pasos (2FA) debidamente configurada y activa.

A partir de la fecha, el ingreso a los módulos de trabajo requiere la validación de su código de 6 dígitos emitido por su aplicación autenticadora (Google Authenticator, Authy o Microsoft Authenticator).

Aquellos usuarios que aún mantengan el 2FA inactivo deben proceder a activarlo ingresando al Hub de Módulos (https://qubira-login.vercel.app/modulo.html) y seleccionando la opción "Seguridad".

Agradecemos su colaboración activa para mantener nuestro entorno seguro.

Atentamente,
Equipo DST · Seguridad Digital Qubira`;

  const content = `
    <div style="padding:22px;">
      <h3 style="margin:0 0 10px;font-size:16px;font-weight:800;">Comunicado General de Ciberseguridad</h3>
      <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">
        Texto redactado para su difusión oficial en canales grupales de comunicación interna (Slack, Teams, WhatsApp corporativo):
      </p>
      <textarea id="modal-comunicado-text" rows="12" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:12px;font-family:inherit;font-size:12px;line-height:1.5;resize:vertical;background:#f9fafb;box-sizing:border-box;">${escapeHtml(comunicado)}</textarea>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button class="btn btn-secondary" id="modal-comunicado-copy">
          ${icon('edit')} Copiar Comunicado
        </button>
        <button class="btn btn-primary" id="modal-comunicado-close">
          Cerrar
        </button>
      </div>
    </div>
  `;

  openModal(content);

  document.getElementById('modal-comunicado-copy')?.addEventListener('click', async () => {
    const text = document.getElementById('modal-comunicado-text').value;
    try {
      await navigator.clipboard.writeText(text);
      toast('Comunicado copiado al portapapeles');
    } catch (_) {
      document.getElementById('modal-comunicado-text').select();
      document.execCommand('copy');
      toast('Comunicado copiado al portapapeles');
    }
  });

  document.getElementById('modal-comunicado-close')?.addEventListener('click', closeModal);
}

function exportCsv() {
  const rows = getFilteredRows();
  if (!rows.length) {
    toast('No hay registros para exportar');
    return;
  }

  const headers = ['ID', 'Nombre', 'Apellidos', 'Usuario', 'Correo', 'Rol', 'Nivel Acceso', 'Area', 'Estado Cuenta', '2FA Activado', 'Fecha Activacion 2FA', 'Ultimo Login', 'Ultima IP'];

  const csvRows = [headers.join(',')];

  rows.forEach(u => {
    const r = [
      u.id,
      `"${(u.nombre || '').replace(/"/g, '""')}"`,
      `"${(u.apellidos || '').replace(/"/g, '""')}"`,
      `"${(u.username || '').replace(/"/g, '""')}"`,
      `"${(u.correo || '').replace(/"/g, '""')}"`,
      `"${(u.rol || '').replace(/"/g, '""')}"`,
      u.nivel_acceso || '',
      `"${(u.area || '').replace(/"/g, '""')}"`,
      `"${(u.estado || '').replace(/"/g, '""')}"`,
      u.totp_enabled ? 'SI' : 'NO',
      u.totp_enabled_at ? `"${u.totp_enabled_at}"` : '',
      u.ultimo_login ? `"${u.ultimo_login}"` : '',
      `"${u.ultima_ip || ''}"`,
    ];
    csvRows.push(r.join(','));
  });

  const blob = new Blob(['\uFEFF' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reporte_Cuentas_Sin_2FA_QUBIRA_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Reporte CSV descargado correctamente');
}
