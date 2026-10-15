import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { confirmDialog, openModal, closeModal, toast } from './ui.js';

let _map = null;
let _heatLayer = null;
let _markersLayer = null;
let _routeLayer = null;
let _locationsData = [];
let _activeSessions = [];
let _activeMode = 'hybrid'; // 'heat' | 'markers' | 'hybrid'
let _searchFilter = '';
let _periodFilter = 'all'; // 'all' | 'today' | 'active'
let _selectedUserId = null;

// Centro de Perú para el mapa
const PERU_CENTER = [-9.189967, -75.015152];
const PERU_ZOOM = 6;

export function renderGeolocalizacion() {
  const container = document.getElementById('view-geolocalizacion');
  if (!container) return;

  container.innerHTML = `
    <!-- Tarjetas de métricas -->
    <div class="geo-kpi-grid">
      <div class="geo-kpi-card">
        <div class="geo-kpi-icon blue">
          <svg class="icon"><use href="#icon-map-pin"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" id="kpi-total-locations">-</div>
          <div class="geo-kpi-label">Ubicaciones Mapeadas</div>
        </div>
      </div>

      <div class="geo-kpi-card">
        <div class="geo-kpi-icon green">
          <svg class="icon"><use href="#icon-users"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" id="kpi-unique-users">-</div>
          <div class="geo-kpi-label">Usuarios con GPS</div>
        </div>
      </div>

      <div class="geo-kpi-card">
        <div class="geo-kpi-icon amber">
          <svg class="icon"><use href="#icon-clock"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" id="kpi-active-gps">-</div>
          <div class="geo-kpi-label">Sesiones Activas con GPS</div>
        </div>
      </div>

      <div class="geo-kpi-card">
        <div class="geo-kpi-icon red">
          <svg class="icon"><use href="#icon-shield"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" id="kpi-suspended-users">-</div>
          <div class="geo-kpi-label">Cuentas Suspendidas</div>
        </div>
      </div>
    </div>

    <!-- Layout principal: Mapa + Panel lateral de accesos -->
    <div class="geo-layout">
      <!-- Contenedor del Mapa -->
      <div class="geo-map-box">
        <div class="geo-map-header">
          <div class="geo-map-title">
            <svg class="icon" style="color:var(--primary);"><use href="#icon-map-pin"></use></svg>
            <span>Mapa Geoespacial y Mapa de Calor — Perú</span>
          </div>

          <div class="geo-map-tools">
            <button class="geo-pill-btn active" id="btn-mode-hybrid" title="Ver calor y marcadores">
              🗺️ Híbrido
            </button>
            <button class="geo-pill-btn" id="btn-mode-heat" title="Solo mapa de calor">
              🔥 Mapa de Calor
            </button>
            <button class="geo-pill-btn" id="btn-mode-markers" title="Solo marcadores">
              📍 Puntos GPS
            </button>
            <button class="geo-pill-btn" id="btn-focus-peru" title="Re-centrar en Perú">
              🇵🇪 Enfocar Perú
            </button>
            <button class="geo-pill-btn" id="btn-refresh-geo" title="Actualizar datos">
              🔄 Actualizar
            </button>
          </div>
        </div>

        <div id="geo-map"></div>
      </div>

      <!-- Panel Lateral de Logins y Acciones Rápidas -->
      <div class="geo-panel-box">
        <div class="geo-panel-header">
          <h3>
            <span>Inicios de Sesión</span>
            <span class="badge gray" id="geo-list-count" style="font-size:11px;font-weight:700;">0 registros</span>
          </h3>

          <div class="geo-search-wrap">
            <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" id="geo-search-input" placeholder="Buscar por usuario, nombre, IP...">
          </div>

          <div style="display:flex; gap:6px; margin-top:10px;">
            <button class="geo-pill-btn active" id="filter-period-all" style="flex:1; justify-content:center; padding:4px 8px; font-size:11px;">Todos</button>
            <button class="geo-pill-btn" id="filter-period-today" style="flex:1; justify-content:center; padding:4px 8px; font-size:11px;">Hoy</button>
            <button class="geo-pill-btn" id="filter-period-active" style="flex:1; justify-content:center; padding:4px 8px; font-size:11px;">Activos</button>
          </div>
        </div>

        <div class="geo-logins-scroll" id="geo-logins-list">
          <div class="empty-state"><p>Cargando ubicaciones…</p></div>
        </div>
      </div>
    </div>
  `;

  setupEventListeners();
  initMap();
  loadData();
}

function setupEventListeners() {
  document.getElementById('btn-mode-hybrid')?.addEventListener('click', () => setMode('hybrid'));
  document.getElementById('btn-mode-heat')?.addEventListener('click', () => setMode('heat'));
  document.getElementById('btn-mode-markers')?.addEventListener('click', () => setMode('markers'));

  document.getElementById('btn-focus-peru')?.addEventListener('click', () => {
    if (_map) _map.flyTo(PERU_CENTER, PERU_ZOOM, { duration: 1 });
  });

  document.getElementById('btn-refresh-geo')?.addEventListener('click', () => {
    loadData();
    toast('Actualizando datos de geolocalización...', 'info');
  });

  const searchInput = document.getElementById('geo-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchFilter = e.target.value.toLowerCase().trim();
      renderLoginsList();
    });
  }

  document.getElementById('filter-period-all')?.addEventListener('click', () => setPeriod('all'));
  document.getElementById('filter-period-today')?.addEventListener('click', () => setPeriod('today'));
  document.getElementById('filter-period-active')?.addEventListener('click', () => setPeriod('active'));

  // Exponer funciones globales para popups de Leaflet y reintentos
  window.traceUserRoute = traceUserRoute;
  window.quickSuspendUser = promptSuspendUser;
  window.quickUnsuspendUser = promptUnsuspendUser;
  window.flyToLocation = flyToLocation;
  window.refreshGeoData = loadData;
}

function setMode(mode) {
  _activeMode = mode;
  ['hybrid', 'heat', 'markers'].forEach(m => {
    document.getElementById(`btn-mode-${m}`)?.classList.toggle('active', m === mode);
  });
  updateMapLayers();
}

function setPeriod(period) {
  _periodFilter = period;
  ['all', 'today', 'active'].forEach(p => {
    document.getElementById(`filter-period-${p}`)?.classList.toggle('active', p === period);
  });
  renderLoginsList();
  updateMapLayers();
}

function initMap() {
  if (typeof L === 'undefined') {
    console.error('[GEO] Leaflet no está cargado');
    return;
  }

  if (_map) {
    _map.remove();
    _map = null;
  }

  const mapEl = document.getElementById('geo-map');
  if (!mapEl) return;

  _map = L.map('geo-map', {
    center: PERU_CENTER,
    zoom: PERU_ZOOM,
    zoomControl: true,
    minZoom: 4,
    maxZoom: 18,
  });

  // Capa base oscura Esri World Dark Gray Canvas (100% gratuita, sin marcas de agua)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap',
    maxZoom: 16
  }).addTo(_map);

  // Capa de referencias, fronteras y etiquetas de ciudades
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16
  }).addTo(_map);

  _markersLayer = L.layerGroup().addTo(_map);
  _routeLayer = L.layerGroup().addTo(_map);

  // Asegurar tamaño correcto del lienzo Leaflet
  setTimeout(() => { if (_map) _map.invalidateSize(); }, 200);
  setTimeout(() => { if (_map) _map.invalidateSize(); }, 600);
}

async function loadData() {
  const listEl = document.getElementById('geo-logins-list');
  try {
    const data = await Store.getLocations();
    _locationsData = data.locations || [];
    _activeSessions = data.active || [];

    // Actualizar KPIs
    const kpiTotal = document.getElementById('kpi-total-locations');
    const kpiUsers = document.getElementById('kpi-unique-users');
    const kpiActive = document.getElementById('kpi-active-gps');
    const kpiSuspended = document.getElementById('kpi-suspended-users');

    if (kpiTotal) kpiTotal.textContent = _locationsData.length;
    if (kpiUsers) kpiUsers.textContent = data.stats?.unique_users || new Set(_locationsData.map(l => l.usuario_id)).size;
    if (kpiActive) kpiActive.textContent = _activeSessions.length;

    const suspendedCount = new Set(_locationsData.filter(l => l.usuario_estado === 'suspendido').map(l => l.usuario_id)).size;
    if (kpiSuspended) kpiSuspended.textContent = suspendedCount;

    renderLoginsList();
    updateMapLayers();

    // Centrar mapa suavemente abarcando los puntos registrados
    if (_locationsData.length > 0 && _map) {
      setTimeout(() => {
        _map.invalidateSize();
        const validCoords = _locationsData
          .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)])
          .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));
        if (validCoords.length > 0) {
          const bounds = L.latLngBounds(validCoords);
          _map.fitBounds(bounds, { maxZoom: 13, padding: [60, 60] });
        }
      }, 350);
    }
  } catch (err) {
    console.error('[GEO] Error cargando ubicaciones:', err);
    toast(err.message || 'Error al consultar la base de datos de ubicaciones', 'error');
    if (listEl) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:28px 16px;text-align:center;">
          <p style="color:var(--danger);font-weight:600;margin-bottom:8px;">${escapeHtml(err.message || 'Error al consultar la base de datos de ubicaciones.')}</p>
          <button class="btn btn-sm btn-primary" onclick="window.refreshGeoData()">Reintentar Consulta</button>
        </div>`;
    }
  }
}

function getFilteredLocations() {
  let list = [..._locationsData];

  // Filtro por período
  if (_periodFilter === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    list = list.filter(l => (l.created_at || '').slice(0, 10) === today);
  } else if (_periodFilter === 'active') {
    const activeUserIds = new Set(_activeSessions.map(s => s.usuario_id));
    list = list.filter(l => activeUserIds.has(l.usuario_id));
  }

  // Filtro por texto de búsqueda
  if (_searchFilter) {
    list = list.filter(l => {
      const q = _searchFilter;
      return (l.username || '').toLowerCase().includes(q) ||
             (l.nombre || '').toLowerCase().includes(q) ||
             (l.apellidos || '').toLowerCase().includes(q) ||
             (l.ip_address || '').toLowerCase().includes(q) ||
             (l.address || '').toLowerCase().includes(q);
    });
  }

  return list;
}

function updateMapLayers() {
  if (!_map) return;

  const filtered = getFilteredLocations();

  // 1. Capa de calor (Heatmap)
  if (_heatLayer) {
    _map.removeLayer(_heatLayer);
    _heatLayer = null;
  }

  if ((_activeMode === 'heat' || _activeMode === 'hybrid') && typeof L.heatLayer === 'function') {
    const heatPoints = filtered.map(l => [
      parseFloat(l.latitude),
      parseFloat(l.longitude),
      0.8 // intensidad
    ]);

    if (heatPoints.length > 0) {
      _heatLayer = L.heatLayer(heatPoints, {
        radius: 28,
        blur: 16,
        maxZoom: 14,
        gradient: {
          0.2: '#3b82f6',
          0.4: '#06b6d4',
          0.6: '#10b981',
          0.8: '#f59e0b',
          1.0: '#ef4444'
        }
      }).addTo(_map);
    }
  }

  // 2. Capa de marcadores
  if (_markersLayer) {
    _markersLayer.clearLayers();
  }

  if (_activeMode === 'markers' || _activeMode === 'hybrid') {
    filtered.forEach(loc => {
      const lat = parseFloat(loc.latitude);
      const lng = parseFloat(loc.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const isSuspended = loc.usuario_estado === 'suspendido';
      const isActiveSession = _activeSessions.some(s => s.usuario_id === loc.usuario_id);

      const pinClass = isSuspended
        ? 'suspended'
        : (isActiveSession ? 'active-session' : '');

      const customIcon = L.divIcon({
        className: 'geo-marker-wrapper',
        html: `
          <div class="geo-marker-pin ${pinClass}">
            <div class="geo-marker-pulse"></div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const initials = ((loc.nombre?.[0] || loc.username?.[0] || '?') + (loc.apellidos?.[0] || '')).toUpperCase();

      const popupHtml = `
        <div class="geo-popup-wrap">
          <div class="geo-popup-content">
            <div class="geo-popup-header">
              <div class="geo-card-avatar" style="background:#3b82f6;color:#fff;">${initials}</div>
              <div>
                <strong style="color:#fff;font-size:13px;display:block;">${escapeHtml(loc.nombre || loc.username)} ${escapeHtml(loc.apellidos || '')}</strong>
                <span style="color:#94a3b8;font-size:11.5px;">@${escapeHtml(loc.username)} · ${escapeHtml(loc.rol || loc.area || 'Usuario')}</span>
              </div>
            </div>

            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">📍 Coordenadas:</span> <strong style="color:#e2e8f0;">${lat.toFixed(6)}, ${lng.toFixed(6)}</strong>
            </div>
            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">🎯 Precisión GPS:</span> <strong style="color:#e2e8f0;">±${Math.round(loc.accuracy || 0)} metros</strong>
            </div>
            ${loc.address ? `<div style="margin-bottom:6px;"><span style="color:#94a3b8;">🗺️ Ubicación:</span> <strong style="color:#e2e8f0;">${escapeHtml(loc.address)}</strong></div>` : ''}
            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">🌐 IP de Acceso:</span> <strong style="color:#e2e8f0;">${escapeHtml(loc.ip_address || 'No registrada')}</strong>
            </div>
            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">⏰ Fecha de Login:</span> <strong style="color:#e2e8f0;">${formatDateTime(loc.created_at)}</strong>
            </div>
            <div style="margin-bottom:8px;">
              <span style="color:#94a3b8;">🛡️ Estado de Cuenta:</span>
              <span class="geo-card-status ${isSuspended ? 'suspendido' : 'activo'}">${isSuspended ? 'Suspendido' : 'Activo'}</span>
            </div>

            <div class="geo-popup-actions">
              <button class="geo-btn-action btn-fly" onclick="window.traceUserRoute(${loc.usuario_id}, '${escapeHtml(loc.username)}')">
                🧭 Trazar Recorrido
              </button>
              ${isSuspended
                ? `<button class="geo-btn-action btn-unsuspend" onclick="window.quickUnsuspendUser(${loc.usuario_id})">✓ Reactivar</button>`
                : `<button class="geo-btn-action btn-suspend" onclick="window.quickSuspendUser(${loc.usuario_id}, '${escapeHtml(loc.username)}', ${lat}, ${lng})">🚫 Suspender Cuenta</button>`
              }
            </div>
          </div>
        </div>
      `;

      const marker = L.marker([lat, lng], { icon: customIcon });
      marker.bindPopup(popupHtml, { maxWidth: 320 });
      marker.addTo(_markersLayer);
    });
  }
}

function renderLoginsList() {
  const container = document.getElementById('geo-logins-list');
  const countBadge = document.getElementById('geo-list-count');
  if (!container) return;

  const filtered = getFilteredLocations();
  if (countBadge) countBadge.textContent = `${filtered.length} accesos`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No se encontraron registros de ubicación con los filtros seleccionados.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(loc => {
    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);
    const isSuspended = loc.usuario_estado === 'suspendido';
    const isActiveSession = _activeSessions.some(s => s.usuario_id === loc.usuario_id);
    const isSelected = _selectedUserId === loc.usuario_id;
    const initials = ((loc.nombre?.[0] || loc.username?.[0] || '?') + (loc.apellidos?.[0] || '')).toUpperCase();

    const timeAgo = getTimeAgo(loc.created_at);

    return `
      <div class="geo-card ${isSelected ? 'selected' : ''}" id="geocard-${loc.id}" onclick="window.flyToLocation(${lat}, ${lng}, ${loc.usuario_id})">
        <div class="geo-card-head">
          <div class="geo-card-user">
            <div class="geo-card-avatar" style="${isActiveSession ? 'background:#ecfdf5;color:#059669;' : ''}">
              ${initials}
            </div>
            <div>
              <div class="geo-card-name">${escapeHtml(loc.nombre || loc.username)} ${escapeHtml(loc.apellidos || '')}</div>
              <div class="geo-card-username">@${escapeHtml(loc.username)} · ${escapeHtml(loc.rol || loc.area || 'Usuario')}</div>
            </div>
          </div>

          <span class="geo-card-status ${isSuspended ? 'suspendido' : 'activo'}">
            ${isSuspended ? 'Suspendido' : (isActiveSession ? 'Activo (En vivo)' : 'Registrado')}
          </span>
        </div>

        <div class="geo-card-details">
          <div><strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)} <span style="color:#059669;font-weight:600;">(±${Math.round(loc.accuracy || 0)}m)</span></div>
          <div><strong>IP:</strong> ${escapeHtml(loc.ip_address || '-')} · <strong>Hora:</strong> ${timeAgo} (${formatDateTime(loc.created_at)})</div>
        </div>

        <div class="geo-card-actions" onclick="event.stopPropagation()">
          <button class="geo-btn-action btn-fly" onclick="window.flyToLocation(${lat}, ${lng}, ${loc.usuario_id})" title="Centrar mapa en este punto">
            <svg class="icon" style="width:13px;height:13px;"><use href="#icon-map-pin"></use></svg>
            Centrar
          </button>

          <button class="geo-btn-action" onclick="window.traceUserRoute(${loc.usuario_id}, '${escapeHtml(loc.username)}')" title="Ver historial de accesos">
            🧭 Recorrido
          </button>

          ${isSuspended
            ? `<button class="geo-btn-action btn-unsuspend" onclick="window.quickUnsuspendUser(${loc.usuario_id})">
                 ✓ Reactivar
               </button>`
            : `<button class="geo-btn-action btn-suspend" onclick="window.quickSuspendUser(${loc.usuario_id}, '${escapeHtml(loc.username)}', ${lat}, ${lng})" title="Suspender cuenta si el acceso es sospechoso">
                 <svg class="icon" style="width:13px;height:13px;"><use href="#icon-lock"></use></svg>
                 Suspender
               </button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function flyToLocation(lat, lng, userId) {
  _selectedUserId = userId;
  document.querySelectorAll('.geo-card').forEach(c => c.classList.remove('selected'));

  if (_map && !isNaN(lat) && !isNaN(lng)) {
    _map.flyTo([lat, lng], 15, { duration: 1.2 });
  }
}

async function traceUserRoute(userId, username) {
  if (!_map) return;
  toast(`Consultando historial de ubicaciones de @${username}...`, 'info');

  try {
    const data = await Store.getUserLocationHistory(userId);
    const history = data.rows || [];

    if (_routeLayer) _routeLayer.clearLayers();

    if (history.length === 0) {
      toast(`No hay más puntos de ubicación registrados para @${username}`, 'warning');
      return;
    }

    if (history.length === 1) {
      const pt = [parseFloat(history[0].latitude), parseFloat(history[0].longitude)];
      _map.flyTo(pt, 14, { duration: 1 });
      toast(`@${username} tiene un único punto registrado en el mapa.`, 'info');
      return;
    }

    const latLngs = history.map(h => [parseFloat(h.latitude), parseFloat(h.longitude)]);

    // Dibujar línea poligonal conectando los puntos
    const polyline = L.polyline(latLngs, {
      color: '#4f46e5',
      weight: 4,
      opacity: 0.85,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(_routeLayer);

    // Agregar marcadores numerados de recorrido
    history.forEach((h, idx) => {
      const pt = [parseFloat(h.latitude), parseFloat(h.longitude)];
      const isLatest = idx === history.length - 1;

      const marker = L.circleMarker(pt, {
        radius: isLatest ? 8 : 6,
        fillColor: isLatest ? '#ef4444' : '#4f46e5',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).bindPopup(`
        <div style="font-size:12px;color:#111;">
          <strong>Punto #${idx + 1} de @${escapeHtml(username)}</strong><br>
          Fecha: ${formatDateTime(h.created_at)}<br>
          GPS: ${pt[0].toFixed(5)}, ${pt[1].toFixed(5)} (±${Math.round(h.accuracy || 0)}m)
        </div>
      `);
      _routeLayer.addLayer(marker);
    });

    _map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    toast(`Recorrido de @${username} trazado con ${history.length} puntos.`, 'success');

  } catch (err) {
    console.error('[GEO] Error trazando recorrido:', err);
    toast('Error al consultar historial de ubicaciones', 'error');
  }
}

function promptSuspendUser(userId, username, lat, lng) {
  const coordTxt = (lat && lng) ? ` (Última ubicación: ${lat.toFixed(4)}, ${lng.toFixed(4)})` : '';
  const modal = openModal({
    title: `Suspender Cuenta de @${username}`,
    size: 'sm',
    bodyHtml: `
      <div style="margin-bottom:14px; font-size:13px; color:var(--text); line-height:1.5;">
        ¿Deseas suspender inmediatamente la cuenta corporativa de <strong>@${escapeHtml(username)}</strong>?
        ${coordTxt ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">${coordTxt}</div>` : ''}
      </div>

      <form id="suspend-geo-form">
        <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px;">Motivo de suspensión:</label>
        <textarea name="motivo" rows="3" class="input" style="width:100%;font-size:12.5px;padding:8px;" required>Acceso detectado en ubicación geográfica no autorizada o sospechosa.</textarea>
      </form>
    `,
    footerHtml: `
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn btn-danger" id="btn-confirm-geo-suspend">🚫 Confirmar Suspensión</button>
    `
  });

  modal.querySelector('#btn-confirm-geo-suspend')?.addEventListener('click', async () => {
    const form = modal.querySelector('#suspend-geo-form');
    if (!form.reportValidity()) return;
    const motivo = new FormData(form).get('motivo');

    try {
      await Store.suspendUser(userId, motivo);
      // Revocar sesiones activas del usuario por seguridad
      await Store.revokeAllSessions(userId).catch(() => {});

      closeModal();
      toast(`Cuenta de @${username} suspendida y sesiones cerradas`, 'success');
      loadData();
    } catch (err) {
      toast(err.message || 'No se pudo suspender la cuenta', 'error');
    }
  });
}

async function promptUnsuspendUser(userId) {
  const ok = await confirmDialog('¿Confirmas reactivar esta cuenta para que pueda volver a iniciar sesión?', {
    title: 'Reactivar Cuenta',
    confirmLabel: 'Reactivar Cuenta',
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
