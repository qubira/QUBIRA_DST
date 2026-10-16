import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { confirmDialog, openModal, closeModal, toast } from './ui.js';
import { isPointInPolygon, distanceToPolygon, calculatePolygonAreaKm2, calculateCentroid } from './geo-utils.js';

let _locations = [];
let _activeSessions = [];
let _geofence = null;
let _filterStatus = 'all'; // 'all' | 'active' | 'today' | 'suspended'
let _searchQuery = '';
const _addressCache = {};

export async function renderAlertasPerimetrales() {
  const container = document.getElementById('view-alertas-perimetrales');
  if (!container) return;

  container.innerHTML = `
    <div style="padding:40px 20px;text-align:center;">
      <div class="empty-state">
        <p>Analizando geocercas y registros de inicio de sesión…</p>
      </div>
    </div>
  `;

  await loadData();
}

async function loadData() {
  try {
    const [locationsData, geofenceData] = await Promise.all([
      Store.getLocations().catch(() => ({ locations: [], active: [] })),
      Store.getGeofence()
    ]);

    const simLocations = Store.getSimulatedLocations();
    _locations = [...simLocations, ...(locationsData.locations || [])];
    _activeSessions = locationsData.active || [];
    _geofence = geofenceData;

    renderViewContent();
  } catch (err) {
    console.error('[ALERTAS] Error cargando datos:', err);
    const container = document.getElementById('view-alertas-perimetrales');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="padding:40px;text-align:center;">
          <p style="color:var(--danger);font-weight:600;">Error al cargar datos forenses de geocercas: ${escapeHtml(err.message || 'Error de conexión')}</p>
          <button class="btn btn-primary" onclick="window.renderAlertasPerimetrales()">Reintentar</button>
        </div>
      `;
    }
  }
}

function getOutOfPerimeterAlerts() {
  if (!_geofence || !_geofence.points || _geofence.points.length < 3) {
    return [];
  }

  const polygon = _geofence.points;
  const alerts = [];

  _locations.forEach(loc => {
    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const inside = isPointInPolygon([lat, lng], polygon);
    if (!inside) {
      const distanceKm = distanceToPolygon([lat, lng], polygon);
      alerts.push({
        ...loc,
        distanceOutKm: distanceKm,
        riskLevel: 'SOSPECHOSO ALTO',
        isActiveSession: _activeSessions.some(s => s.usuario_id === loc.usuario_id || s.id === loc.id)
      });
    }
  });

  // Actualizar contador del menú lateral
  const navBadge = document.getElementById('nav-alert-counter');
  if (navBadge) {
    navBadge.textContent = alerts.length;
    navBadge.style.display = alerts.length > 0 ? 'inline-block' : 'none';
  }

  return alerts;
}

function renderViewContent() {
  const container = document.getElementById('view-alertas-perimetrales');
  if (!container) return;

  const allAlerts = getOutOfPerimeterAlerts();
  const activeAlertsCount = allAlerts.filter(a => a.isActiveSession).length;
  const uniqueUsersCount = new Set(allAlerts.map(a => a.usuario_id)).size;
  const perimeterVertices = _geofence?.points?.length || 0;
  const perimeterArea = _geofence?.points ? calculatePolygonAreaKm2(_geofence.points).toFixed(1) : '0';

  container.innerHTML = `
    <!-- Barra Superior de Resumen y Acciones -->
    <div class="geo-alert-topbar">
      <div class="geo-alert-title-box">
        <div class="geo-alert-icon-main">
          <svg class="icon" style="width:24px;height:24px;"><use href="#icon-alert-triangle"></use></svg>
        </div>
        <div>
          <h2 style="margin:0;font-size:17px;font-weight:700;color:var(--text);">Reporte Forense de Inicios Fuera de Perímetro</h2>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:2px;">
            Auditoría de seguridad geoespacial — Accesos detectados fuera del rango autorizado clasificados como <strong>Sospechoso Alto</strong>.
          </div>
        </div>
      </div>

      <div class="geo-alert-actions-bar">
        ${perimeterVertices >= 3 ? `
          <button class="btn btn-primary btn-sm" id="btn-goto-edit-map" title="Editar y mover los vértices del perímetro actual en el mapa">
            ✏️ Editar Perímetro
          </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" id="btn-goto-draw-map" title="Abrir el mapa interactivo para delimitar perímetro nuevo">
          📐 ${perimeterVertices >= 3 ? 'Nuevo Perímetro' : 'Dibujar Perímetro'}
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-export-csv" title="Descargar auditoría en formato CSV">
          📥 Exportar CSV
        </button>
        <button class="btn btn-secondary btn-sm" id="btn-print-report" title="Imprimir informe forense">
          🖨️ Imprimir
        </button>
        <button class="btn btn-danger btn-sm" id="btn-simulate-alert" title="Crear un intento simulado fuera del perímetro para probar la alerta en tiempo real">
          🧪 Probar Alerta en Vivo
        </button>
      </div>
    </div>

    <!-- Tarjetas de Métricas Forenses -->
    <div class="geo-kpi-grid" style="margin-bottom:20px;">
      <div class="geo-kpi-card" style="border-left: 4px solid var(--danger);">
        <div class="geo-kpi-icon red">
          <svg class="icon"><use href="#icon-alert-triangle"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" style="color:var(--danger);">${allAlerts.length}</div>
          <div class="geo-kpi-label">Inicios Fuera de Perímetro</div>
        </div>
      </div>

      <div class="geo-kpi-card" style="border-left: 4px solid #ea580c;">
        <div class="geo-kpi-icon amber">
          <svg class="icon"><use href="#icon-clock"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" style="color:#ea580c;">${activeAlertsCount}</div>
          <div class="geo-kpi-label">Sesiones Activas Fuera de Zona</div>
        </div>
      </div>

      <div class="geo-kpi-card" style="border-left: 4px solid var(--primary);">
        <div class="geo-kpi-icon blue">
          <svg class="icon"><use href="#icon-users"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num">${uniqueUsersCount}</div>
          <div class="geo-kpi-label">Usuarios con Alertas</div>
        </div>
      </div>

      <div class="geo-kpi-card" style="border-left: 4px solid var(--success);">
        <div class="geo-kpi-icon green">
          <svg class="icon"><use href="#icon-shield"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" style="font-size:18px;font-weight:700;">
            ${perimeterVertices >= 3 ? `<span style="color:var(--success);">Activo (${perimeterVertices} pts)</span>` : '<span style="color:var(--warning);">No configurado</span>'}
          </div>
          <div class="geo-kpi-label">${perimeterVertices >= 3 ? `Área aprox: ${perimeterArea} km²` : 'Dibuja el perímetro en el mapa'}</div>
        </div>
      </div>
    </div>

    <!-- Banner de Estado de la Geocerca -->
    <div class="geo-perimeter-status-banner ${perimeterVertices >= 3 ? 'active' : 'warning'}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="status-indicator-dot ${perimeterVertices >= 3 ? 'green' : 'amber'}"></div>
        <div>
          <strong style="font-size:13px;display:block;">
            ${perimeterVertices >= 3 
              ? `🛡️ Perímetro Seguro Activo: "${escapeHtml(_geofence.name || 'Perímetro Corporativo Autorizado')}"` 
              : '⚠️ Ningún perímetro perimetral dibujado todavía'}
          </strong>
          <span style="font-size:12px;color:var(--text-muted);">
            ${perimeterVertices >= 3 
              ? `Todo inicio de sesión que ocurra fuera de los ${perimeterVertices} vértices delimitados en el mapa dispara automáticamente una alerta como "SOSPECHOSO ALTO".`
              : 'Para delimitar la zona de logeo permitida, haz clic en el botón "Dibujar Perímetro en Mapa" y traza los puntos con el ratón.'}
          </span>
        </div>
      </div>

      <div style="display:flex;gap:8px;align-items:center;">
        ${Store.getSimulatedLocations().length > 0 ? `
          <button class="btn btn-secondary btn-sm" id="btn-clear-simulated" title="Remover registros de prueba">
            🧹 Limpiar Registros de Prueba (${Store.getSimulatedLocations().length})
          </button>
        ` : ''}
        ${perimeterVertices >= 3 ? `
          <button class="btn btn-primary btn-sm" id="btn-edit-perimeter-banner" title="Mover y ajustar vértices del perímetro en el mapa">
            ✏️ Editar Vértices
          </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" id="btn-manage-perimeter">
          ${perimeterVertices >= 3 ? '📐 Redibujar Nuevo' : '📐 Trazar Perímetro en Mapa'}
        </button>
      </div>
    </div>

    <!-- Filtros y Barra de Búsqueda -->
    <div class="geo-alert-toolbar">
      <div class="geo-alert-filter-group">
        <button class="geo-filter-btn ${(_filterStatus === 'all') ? 'active' : ''}" data-status="all">
          Todos los Sospechosos Altos (${allAlerts.length})
        </button>
        <button class="geo-filter-btn ${(_filterStatus === 'active') ? 'active' : ''}" data-status="active">
          ⚡ En Vivo / Sesión Activa (${activeAlertsCount})
        </button>
        <button class="geo-filter-btn ${(_filterStatus === 'today') ? 'active' : ''}" data-status="today">
          📅 Registrados Hoy
        </button>
        <button class="geo-filter-btn ${(_filterStatus === 'suspended') ? 'active' : ''}" data-status="suspended">
          🚫 Cuentas Suspendidas
        </button>
      </div>

      <div class="geo-search-box-wrap">
        <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="text" id="alert-search-input" placeholder="Buscar por usuario, nombre, IP o ciudad..." value="${escapeHtml(_searchQuery)}">
      </div>
    </div>

    <!-- Contenedor del Listado y Tabla Forense -->
    <div class="card" style="margin-top:14px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);">
      <div id="alerts-table-container"></div>
    </div>
  `;

  renderTableRows(allAlerts);
  setupEvents();
}

function renderTableRows(allAlerts) {
  const container = document.getElementById('alerts-table-container');
  if (!container) return;

  let filtered = [...allAlerts];

  // Filtro por estado
  if (_filterStatus === 'active') {
    filtered = filtered.filter(a => a.isActiveSession);
  } else if (_filterStatus === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter(a => (a.created_at || '').slice(0, 10) === today);
  } else if (_filterStatus === 'suspended') {
    filtered = filtered.filter(a => a.usuario_estado === 'suspendido');
  }

  // Filtro por texto de búsqueda
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(a => {
      return (a.username || '').toLowerCase().includes(q) ||
             (a.nombre || '').toLowerCase().includes(q) ||
             (a.apellidos || '').toLowerCase().includes(q) ||
             (a.ip_address || '').toLowerCase().includes(q) ||
             (a.address || '').toLowerCase().includes(q);
    });
  }

  if (filtered.length === 0) {
    if (!_geofence || !_geofence.points || _geofence.points.length < 3) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px 20px;text-align:center;">
          <div style="font-size:36px;margin-bottom:12px;">📐</div>
          <strong style="font-size:15px;display:block;margin-bottom:6px;">No se ha delimitado un perímetro seguro aún</strong>
          <p style="color:var(--text-muted);max-width:440px;margin:0 auto 16px;">
            Dibuja el perímetro en el mapa interactivo haciendo clic sobre la zona geográfica autorizada. Los inicios de sesión fuera de esa frontera aparecerán aquí clasificados como <strong>Sospechoso Alto</strong>.
          </p>
          <button class="btn btn-primary" onclick="window.navigateToGeofenceDrawing()">
            Dibujar Perímetro en el Mapa
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="empty-state" style="padding:48px 20px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">✅</div>
        <strong style="font-size:15px;display:block;margin-bottom:6px;">No hay inicios de sesión fuera del perímetro</strong>
        <p style="color:var(--text-muted);max-width:440px;margin:0 auto 16px;">
          Todos los accesos registrados se encuentran dentro de la zona segura corporativa o no coinciden con los filtros aplicados.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="window.simulatePerimeterBreach()">
          🧪 Probar Alerta con Simulación
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid var(--border);text-align:left;font-size:12px;color:var(--text-muted);">
            <th style="padding:12px 14px;">Clasificación / Riesgo</th>
            <th style="padding:12px 14px;">Colaborador / Cuenta</th>
            <th style="padding:12px 14px;">Coordenadas GPS</th>
            <th style="padding:12px 14px;">Distancia Fuera de Zona</th>
            <th style="padding:12px 14px;">IP / Red</th>
            <th style="padding:12px 14px;">Fecha y Hora</th>
            <th style="padding:12px 14px;">Estado</th>
            <th style="padding:12px 14px;text-align:right;">Acciones Inmediatas</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(item => {
            const lat = parseFloat(item.latitude);
            const lng = parseFloat(item.longitude);
            const accuracy = Math.round(item.accuracy || 0);
            const initials = ((item.nombre?.[0] || item.username?.[0] || '?') + (item.apellidos?.[0] || '')).toUpperCase();
            const isSuspended = item.usuario_estado === 'suspendido';
            const isActive = item.isActiveSession;
            const timeAgo = getTimeAgo(item.created_at);

            return `
              <tr class="alert-row-danger" style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:12px 14px;vertical-align:middle;">
                  <span class="badge-sospechoso-alto">
                    <span class="pulsing-red-dot"></span>
                    🚨 SOSPECHOSO ALTO
                  </span>
                  <div style="font-size:10.5px;color:#dc2626;font-weight:600;margin-top:4px;">
                    Fuera de Rango Perimetral
                  </div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <div class="geo-card-avatar" style="background:#fee2e2;color:#b91c1c;font-weight:700;">
                      ${initials}
                    </div>
                    <div>
                      <strong style="font-size:13px;display:block;color:var(--text);">
                        ${escapeHtml(item.nombre || item.username)} ${escapeHtml(item.apellidos || '')}
                      </strong>
                      <span style="font-size:11.5px;color:var(--text-muted);">
                        @${escapeHtml(item.username)} · ${escapeHtml(item.rol || item.area || 'Colaborador')}
                      </span>
                    </div>
                  </div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;">
                  <div style="font-family:monospace;font-size:12px;font-weight:600;color:var(--text);">
                    ${lat.toFixed(5)}, ${lng.toFixed(5)}
                  </div>
                  <div style="font-size:11px;color:#059669;font-weight:600;">
                    Margen GPS: ±${accuracy}m
                  </div>
                  <div style="font-size:11px;color:#64748b;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="addr-forensic-${item.id}">
                    ${escapeHtml(item.address || 'Ubicación remota')}
                  </div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;">
                  <span class="badge-distance-out">
                    +${item.distanceOutKm.toFixed(1)} km
                  </span>
                  <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">
                    del límite permitido
                  </div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-family:monospace;font-size:12px;font-weight:600;color:var(--text);">
                      ${escapeHtml(item.ip_address || '-')}
                    </span>
                    ${item.ip_address ? `
                      <button class="btn-copy-mini" onclick="window.copyToClipboard('${escapeHtml(item.ip_address)}')" title="Copiar IP">
                        📋
                      </button>
                    ` : ''}
                  </div>
                  <div style="font-size:10.5px;color:var(--text-muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.user_agent || '')}">
                    ${escapeHtml(item.user_agent ? item.user_agent.split(' ')[0] : 'Dispositivo Web')}
                  </div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;white-space:nowrap;">
                  <div style="font-size:12px;font-weight:600;color:var(--text);">${formatDateTime(item.created_at)}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${timeAgo}</div>
                </td>

                <td style="padding:12px 14px;vertical-align:middle;">
                  ${isSuspended
                    ? `<span class="geo-card-status suspendido">🚫 Cuenta Suspendida</span>`
                    : (isActive
                        ? `<span class="geo-card-status activo" style="background:#fee2e2;color:#b91c1c;border:1px solid #f87171;">⚡ Sesión Activa</span>`
                        : `<span class="badge gray">Acceso Finalizado</span>`
                      )
                  }
                </td>

                <td style="padding:12px 14px;vertical-align:middle;text-align:right;">
                  <div style="display:inline-flex;gap:6px;align-items:center;">
                    <button class="btn btn-sm btn-primary" onclick="window.viewIncidentOnMap(${lat}, ${lng}, '${item.id}', ${item.usuario_id})" title="Abrir y centrar en el mapa">
                      📍 Ver en Mapa
                    </button>

                    ${isSuspended
                      ? `<button class="btn btn-sm btn-secondary" onclick="window.reactivateUserAlert(${item.usuario_id})" title="Reactivar usuario">
                          ✓ Reactivar
                        </button>`
                      : `<button class="btn btn-sm btn-danger" onclick="window.suspendUserAlert(${item.usuario_id}, '${escapeHtml(item.username)}', ${lat}, ${lng}, ${item.distanceOutKm.toFixed(1)})" title="Suspender cuenta de inmediato por acceso fuera de perímetro">
                          🚫 Suspender
                        </button>`
                    }

                    <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="Abrir en Google Maps">
                      🗺️
                    </a>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function setupEvents() {
  document.querySelectorAll('.geo-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.geo-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _filterStatus = btn.dataset.status;
      renderTableRows(getOutOfPerimeterAlerts());
    });
  });

  const searchInput = document.getElementById('alert-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value.trim();
      renderTableRows(getOutOfPerimeterAlerts());
    });
  }

  document.getElementById('btn-goto-draw-map')?.addEventListener('click', () => {
    window.navigateToGeofenceDrawing();
  });

  document.getElementById('btn-goto-edit-map')?.addEventListener('click', () => {
    window.navigateToGeofenceEditing();
  });

  document.getElementById('btn-edit-perimeter-banner')?.addEventListener('click', () => {
    window.navigateToGeofenceEditing();
  });

  document.getElementById('btn-manage-perimeter')?.addEventListener('click', () => {
    window.navigateToGeofenceDrawing();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    exportAlertsCsv(getOutOfPerimeterAlerts());
  });

  document.getElementById('btn-print-report')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-simulate-alert')?.addEventListener('click', () => {
    window.simulatePerimeterBreach();
  });

  document.getElementById('btn-clear-simulated')?.addEventListener('click', () => {
    Store.clearSimulatedLocations();
    toast('Registros de simulación limpiados', 'info');
    loadData();
  });

  // Globales para acciones de fila
  window.viewIncidentOnMap = (lat, lng, locId, userId) => {
    // Guardar coordenadas de salto para el mapa
    sessionStorage.setItem('qubira_dst_jump_target', JSON.stringify({ lat, lng, locId, userId }));
    if (window.navigateToView) {
      window.navigateToView('geolocalizacion');
    }
  };

  window.navigateToGeofenceDrawing = () => {
    sessionStorage.setItem('qubira_dst_activate_drawing', 'true');
    if (window.navigateToView) {
      window.navigateToView('geolocalizacion');
    }
  };

  window.navigateToGeofenceEditing = () => {
    sessionStorage.setItem('qubira_dst_activate_editing', 'true');
    if (window.navigateToView) {
      window.navigateToView('geolocalizacion');
    }
  };

  window.suspendUserAlert = promptSuspendUserAlert;
  window.reactivateUserAlert = promptReactivateUserAlert;
  window.simulatePerimeterBreach = simulateOutOfRangeLogin;
  window.copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    toast(`IP copiada al portapapeles: ${text}`, 'success');
  };
}

function promptSuspendUserAlert(userId, username, lat, lng, distanceKm) {
  const modal = openModal({
    title: `🚨 Suspender Cuenta — Violación de Perímetro`,
    size: 'sm',
    bodyHtml: `
      <div style="font-size:13px;line-height:1.5;color:var(--text);margin-bottom:12px;">
        Se ha detectado un inicio de sesión clasificado como <strong>SOSPECHOSO ALTO</strong> para la cuenta <strong>@${escapeHtml(username)}</strong> a <strong>${distanceKm} km</strong> fuera del perímetro de seguridad corporativo.
      </div>

      <div style="background:#fee2e2;border:1px solid #f87171;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#991b1b;">
        ⚠️ Al confirmar, la cuenta quedará suspendida en todo el ecosistema Qubira y sus sesiones activas serán revocadas inmediatamente.
      </div>

      <form id="form-suspend-perimeter">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Motivo de suspensión:</label>
        <textarea name="motivo" rows="2" class="input" style="width:100%;font-size:12px;padding:8px;" required>Acceso detectado fuera del perímetro corporativo autorizado (Sospechoso Alto · a ${distanceKm} km del límite).</textarea>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn btn-danger" id="btn-confirm-alert-suspend">🚫 Confirmar Suspensión</button>
    `
  });

  modal.querySelector('#btn-confirm-alert-suspend')?.addEventListener('click', async () => {
    const form = modal.querySelector('#form-suspend-perimeter');
    if (!form.reportValidity()) return;
    const motivo = new FormData(form).get('motivo');

    try {
      await Store.suspendUser(userId, motivo);
      await Store.revokeAllSessions(userId).catch(() => {});
      closeModal();
      toast(`Cuenta @${username} suspendida y sesiones revocadas por seguridad`, 'success');
      loadData();
    } catch (err) {
      toast(err.message || 'No se pudo suspender la cuenta', 'error');
    }
  });
}

async function promptReactivateUserAlert(userId) {
  const ok = await confirmDialog('¿Confirmas reactivar esta cuenta para que pueda volver a iniciar sesión?', {
    title: 'Reactivar Cuenta',
    confirmLabel: 'Reactivar',
    danger: false
  });
  if (!ok) return;

  try {
    await Store.unsuspendUser(userId);
    toast('Cuenta reactivada exitosamente', 'success');
    loadData();
  } catch (err) {
    toast(err.message || 'Error al reactivar cuenta', 'error');
  }
}

/**
 * Función para simular inmediatamente un inicio de sesión fuera de perímetro.
 * Permite probar de inmediato la generación de alertas como "Sospechoso Alto".
 */
export function simulateOutOfRangeLogin() {
  const simulatedCities = [
    { name: 'Trujillo, Perú (Fuera de Rango)', lat: -8.111677, lng: -79.028774, addr: 'Av. España, Trujillo, La Libertad, Perú', ip: '190.235.14.88' },
    { name: 'Arequipa, Perú (Fuera de Rango)', lat: -16.409047, lng: -71.537451, addr: 'Calle Mercaderes, Arequipa, Perú', ip: '181.176.44.12' },
    { name: 'Cusco, Perú (Fuera de Rango)', lat: -13.531950, lng: -71.967463, addr: 'Plaza de Armas, Cusco, Perú', ip: '190.119.82.95' },
    { name: 'Madrid, España (Internacional SOSPECHOSO ALTO)', lat: 40.416775, lng: -3.703790, addr: 'Gran Vía, Madrid, España', ip: '88.26.112.4' }
  ];

  const city = simulatedCities[Math.floor(Math.random() * simulatedCities.length)];
  const dummyUsernames = ['jaranda', 'mrodriguez', 'cflores', 'lquispe', 'vcastillo'];
  const dummyUser = dummyUsernames[Math.floor(Math.random() * dummyUsernames.length)];

  const simItem = {
    id: 'sim_' + Date.now(),
    usuario_id: 99000 + Math.floor(Math.random() * 900),
    username: dummyUser,
    nombre: 'Usuario Prueba',
    apellidos: `(${city.name.split(',')[0]})`,
    latitude: city.lat,
    longitude: city.lng,
    accuracy: 14,
    address: city.addr,
    ip_address: city.ip,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0',
    created_at: new Date().toISOString(),
    usuario_estado: 'activo',
    rol: 'Especialista',
    area: 'Operaciones',
    is_simulation: true
  };

  Store.addSimulatedLocation(simItem);
  toast(`🚨 Simulación agregada: Acceso reportado en ${city.name} como SOSPECHOSO ALTO`, 'error');
  loadData();
}

function exportAlertsCsv(alerts) {
  if (!alerts || alerts.length === 0) {
    toast('No hay alertas fuera de perímetro para exportar', 'warning');
    return;
  }

  const headers = ['ID', 'Nivel de Riesgo', 'Usuario', 'Nombre', 'Rol', 'Área', 'Latitud', 'Longitud', 'Distancia Fuera (km)', 'IP', 'Dirección', 'Fecha'];
  const rows = alerts.map(a => [
    a.id,
    'SOSPECHOSO ALTO (Fuera de Perímetro)',
    a.username,
    `"${(a.nombre || '')} ${(a.apellidos || '')}"`,
    a.rol || '-',
    a.area || '-',
    a.latitude,
    a.longitude,
    a.distanceOutKm.toFixed(2),
    a.ip_address || '-',
    `"${(a.address || '').replace(/"/g, '""')}"`,
    a.created_at
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `QUBIRA_DST_Alertas_Perimetrales_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast('Reporte CSV descargado exitosamente', 'success');
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Hace instantes';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Hace ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  return `Hace ${diffDays}d`;
}
