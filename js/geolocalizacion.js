import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { confirmDialog, openModal, closeModal, toast } from './ui.js';
import { isPointInPolygon, distanceToPolygon, calculateCentroid, calculatePolygonAreaKm2 } from './geo-utils.js';

let _map = null;
let _baseLayerGroup = null;
let _currentBasemap = 'calles'; // 'calles' | 'satelite' | 'oscuro'
let _heatLayer = null;
let _markersLayer = null;
let _routeLayer = null;
let _geofenceLayer = null;
let _markersById = {}; // Mapeo de id de login a Marker de Leaflet
let _locationsData = [];
let _activeSessions = [];
let _activeMode = 'markers'; // 'markers' | 'hybrid' | 'heat'
let _searchFilter = '';
let _periodFilter = 'all'; // 'all' | 'today' | 'active' | 'out_of_bounds'
let _selectedUserId = null;
const _addressCache = {}; // Cache local para geocodificación inversa

// Geocerca y Perímetro
let _geofence = null;
let _isDrawingMode = false;
let _drawingPoints = [];
let _drawingMarkers = [];
let _drawingLine = null;
let _drawingPolygonPreview = null;
let _outOfBoundsLocations = [];
let _showPerimeter = true;

// Modo Edición interactiva de vértices existentes
let _isEditingMode = false;
let _editingPoints = [];
let _editingMarkers = [];
let _editingMidpointMarkers = [];
let _editingPolygon = null;
let _editingHistory = [];

// Centro de Perú para el mapa
const PERU_CENTER = [-9.189967, -75.015152];
const PERU_ZOOM = 6;

// Configuración de capas base sin marcas de agua y con soporte de zoom ultra-alto
const BASE_MAPS = {
  calles: {
    name: 'Calles (OSM)',
    create: () => [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: ['a', 'b', 'c'],
        maxZoom: 20,
        maxNativeZoom: 19
      })
    ]
  },
  satelite: {
    name: 'Satélite HD',
    create: () => [
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri World Imagery',
        maxZoom: 20,
        maxNativeZoom: 19
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        maxNativeZoom: 19
      })
    ]
  },
  oscuro: {
    name: 'Modo Oscuro',
    create: () => [
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri Dark Canvas',
        maxZoom: 20,
        maxNativeZoom: 16
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        maxNativeZoom: 16
      })
    ]
  }
};

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

      <div class="geo-kpi-card" style="border-left:4px solid var(--danger);">
        <div class="geo-kpi-icon red">
          <svg class="icon"><use href="#icon-alert-triangle"></use></svg>
        </div>
        <div>
          <div class="geo-kpi-num" id="kpi-out-of-bounds" style="color:var(--danger);">-</div>
          <div class="geo-kpi-label">Fuera de Perímetro (Sospechoso Alto)</div>
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
            <span>Mapa Geoespacial y Calidad GPS — Perú</span>
          </div>

          <div class="geo-map-tools">
            <!-- Selector de mapa base -->
            <div class="geo-pill-group" title="Capa de mapa base">
              <button class="geo-pill-btn active" id="btn-base-calles">🛣️ Calles</button>
              <button class="geo-pill-btn" id="btn-base-satelite">🛰️ Satélite HD</button>
              <button class="geo-pill-btn" id="btn-base-oscuro">🌙 Oscuro</button>
            </div>

            <!-- Modos de visualización -->
            <div class="geo-pill-group" title="Modo de visualización de datos">
              <button class="geo-pill-btn active" id="btn-mode-markers">📍 Puntos GPS</button>
              <button class="geo-pill-btn" id="btn-mode-hybrid">🗺️ Híbrido</button>
              <button class="geo-pill-btn" id="btn-mode-heat">🔥 Calor</button>
            </div>

            <!-- Herramientas de Perímetro de Seguridad -->
            <div class="geo-pill-group" title="Gestión y Edición de Perímetro de Logeo">
              <button class="geo-pill-btn" id="btn-tool-draw-perimeter" title="Trazar nuevo perímetro desde cero">
                📐 Nuevo
              </button>
              <button class="geo-pill-btn" id="btn-tool-edit-perimeter" title="Mover y ajustar vértices del perímetro actual" style="display:none;color:#4f46e5;font-weight:700;">
                ✏️ Editar Perímetro
              </button>
              <button class="geo-pill-btn" id="btn-tool-toggle-perimeter" title="Mostrar/ocultar zona segura">
                🛡️ Ver Zona
              </button>
              <button class="geo-pill-btn" id="btn-tool-clear-perimeter" title="Borrar perímetro configurado" style="display:none;color:#ef4444;">
                🗑️ Borrar
              </button>
            </div>

            <button class="geo-pill-btn btn-danger-pill" id="btn-jump-alerts-rep" title="Ver reporte forense completo de alertas fuera de perímetro" style="color:#b91c1c;background:#fee2e2;border-color:#fca5a5;">
              🚨 Fuera de Rango (<span id="btn-alert-count-pill">0</span>)
            </button>

            <button class="geo-pill-btn" id="btn-focus-peru" title="Re-centrar en Perú">
              🇵🇪 Perú
            </button>
            <button class="geo-pill-btn" id="btn-refresh-geo" title="Actualizar datos">
              🔄
            </button>
          </div>
        </div>

        <!-- Banner Flotante de Alerta si hay accesos fuera de rango -->
        <div class="geo-perimeter-alert-banner" id="geo-perimeter-alert-banner" style="display:none;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="pulsing-red-dot"></span>
            <span>🚨 <strong>ALERTA CRÍTICA:</strong> Se detectaron <strong id="banner-out-count">0</strong> inicio(s) de sesión <strong>FUERA del perímetro seguro corporativo</strong> (Sospechoso Alto).</span>
          </div>
          <button class="btn btn-sm btn-danger" onclick="window.navigateToView('alertas-perimetrales')">
            Ver Reporte Forense ➔
          </button>
        </div>

        <!-- Barra Flotante de Modo Dibujo de Geocerca -->
        <div class="geo-drawing-floating-bar" id="geo-drawing-bar" style="display:none;">
          <div class="geo-drawing-info">
            <strong>✏️ Modo Dibujo de Perímetro Seguro Activo</strong>
            <span>Haz clic en el mapa para marcar los vértices de la geocerca corporativa. (<strong id="draw-point-count">0</strong> vértices colocados)</span>
          </div>
          <div class="geo-drawing-actions">
            <button class="btn btn-sm btn-secondary" id="btn-draw-undo">↶ Deshacer Punto</button>
            <button class="btn btn-sm btn-primary" id="btn-draw-save">💾 Guardar Perímetro</button>
            <button class="btn btn-sm btn-secondary" id="btn-draw-cancel">✕ Cancelar</button>
          </div>
        </div>

        <!-- Barra Flotante de Modo Edición de Geocerca Existente -->
        <div class="geo-drawing-floating-bar edit-mode" id="geo-editing-bar" style="display:none;">
          <div class="geo-drawing-info">
            <strong style="color:#38bdf8;">✏️ Modo Edición de Perímetro Activo</strong>
            <span>Arrastra los círculos verdes para mover los vértices. Haz clic en <strong>(+)</strong> para añadir puntos intermedios, o clic derecho en un vértice para eliminarlo. (<strong id="edit-point-count">0</strong> vértices)</span>
          </div>
          <div class="geo-drawing-actions">
            <button class="btn btn-sm btn-secondary" id="btn-edit-undo" title="Deshacer último cambio">↶ Deshacer</button>
            <button class="btn btn-sm btn-primary" id="btn-edit-save" title="Guardar modificaciones">💾 Guardar Cambios</button>
            <button class="btn btn-sm btn-secondary" id="btn-edit-cancel" title="Descartar cambios">✕ Cancelar</button>
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
            <input type="text" id="geo-search-input" placeholder="Buscar por usuario, nombre, IP, calle...">
          </div>

          <div style="display:flex; gap:5px; margin-top:10px; flex-wrap:wrap;">
            <button class="geo-pill-btn active" id="filter-period-all" style="flex:1; justify-content:center; padding:4px 6px; font-size:11px;">Todos</button>
            <button class="geo-pill-btn" id="filter-period-today" style="flex:1; justify-content:center; padding:4px 6px; font-size:11px;">Hoy</button>
            <button class="geo-pill-btn" id="filter-period-active" style="flex:1; justify-content:center; padding:4px 6px; font-size:11px;">Activos</button>
            <button class="geo-pill-btn" id="filter-period-out" style="flex:1.2; justify-content:center; padding:4px 6px; font-size:11px; color:#b91c1c;" title="Filtrar accesos sospechosos altos fuera de perímetro">
              🚨 Fuera de Rango (<span id="filter-badge-out">0</span>)
            </button>
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
  // Conmutadores de capa base
  document.getElementById('btn-base-calles')?.addEventListener('click', () => switchBasemap('calles'));
  document.getElementById('btn-base-satelite')?.addEventListener('click', () => switchBasemap('satelite'));
  document.getElementById('btn-base-oscuro')?.addEventListener('click', () => switchBasemap('oscuro'));

  // Modos de datos
  document.getElementById('btn-mode-markers')?.addEventListener('click', () => setMode('markers'));
  document.getElementById('btn-mode-hybrid')?.addEventListener('click', () => setMode('hybrid'));
  document.getElementById('btn-mode-heat')?.addEventListener('click', () => setMode('heat'));

  // Herramientas de dibujo, edición y gestión de perímetro
  document.getElementById('btn-tool-draw-perimeter')?.addEventListener('click', startDrawingPerimeter);
  document.getElementById('btn-tool-edit-perimeter')?.addEventListener('click', startEditingPerimeter);
  document.getElementById('btn-tool-toggle-perimeter')?.addEventListener('click', togglePerimeter);
  document.getElementById('btn-tool-clear-perimeter')?.addEventListener('click', promptClearPerimeter);

  // Acciones en la barra flotante de dibujo
  document.getElementById('btn-draw-undo')?.addEventListener('click', undoDrawingPoint);
  document.getElementById('btn-draw-save')?.addEventListener('click', saveDrawingPerimeter);
  document.getElementById('btn-draw-cancel')?.addEventListener('click', cancelDrawingPerimeter);

  // Acciones en la barra flotante de edición
  document.getElementById('btn-edit-undo')?.addEventListener('click', undoEditingPerimeter);
  document.getElementById('btn-edit-save')?.addEventListener('click', saveEditedPerimeter);
  document.getElementById('btn-edit-cancel')?.addEventListener('click', cancelEditingPerimeter);

  document.getElementById('btn-jump-alerts-rep')?.addEventListener('click', () => {
    if (window.navigateToView) window.navigateToView('alertas-perimetrales');
  });

  document.getElementById('btn-focus-peru')?.addEventListener('click', () => {
    if (_map) _map.flyTo(PERU_CENTER, PERU_ZOOM, { duration: 1 });
  });

  document.getElementById('btn-refresh-geo')?.addEventListener('click', () => {
    loadData();
    toast('Actualizando datos de geolocalización y geocercas...', 'info');
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
  document.getElementById('filter-period-out')?.addEventListener('click', () => setPeriod('out_of_bounds'));

  // Exponer funciones globales para popups de Leaflet y enlaces externos
  window.traceUserRoute = traceUserRoute;
  window.quickSuspendUser = promptSuspendUser;
  window.quickUnsuspendUser = promptUnsuspendUser;
  window.flyToLocation = flyToLocation;
  window.refreshGeoData = loadData;
  window.startDrawingPerimeterOnMap = startDrawingPerimeter;
  window.startEditingPerimeterOnMap = startEditingPerimeter;
}

function switchBasemap(type) {
  if (!_map || !BASE_MAPS[type]) return;
  _currentBasemap = type;

  if (_baseLayerGroup) {
    try { _map.removeLayer(_baseLayerGroup); } catch (_) {}
    _baseLayerGroup = null;
  }

  try {
    const layers = BASE_MAPS[type].create();
    _baseLayerGroup = L.layerGroup(layers).addTo(_map);
  } catch (err) {
    console.error('[GEO] Error creando capa base:', err);
  }

  ['calles', 'satelite', 'oscuro'].forEach(k => {
    document.getElementById(`btn-base-${k}`)?.classList.toggle('active', k === type);
  });
}

function setMode(mode) {
  _activeMode = mode;
  ['markers', 'hybrid', 'heat'].forEach(m => {
    document.getElementById(`btn-mode-${m}`)?.classList.toggle('active', m === mode);
  });
  updateMapLayers();
}

function setPeriod(period) {
  _periodFilter = period;
  ['all', 'today', 'active', 'out'].forEach(p => {
    const idKey = p === 'out' ? 'out' : p;
    document.getElementById(`filter-period-${idKey}`)?.classList.toggle('active', period === (p === 'out' ? 'out_of_bounds' : p));
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
    try { _map.remove(); } catch (_) {}
    _map = null;
    _markersLayer = null;
    _routeLayer = null;
    _baseLayerGroup = null;
    _heatLayer = null;
    _geofenceLayer = null;
  }

  const mapEl = document.getElementById('geo-map');
  if (!mapEl) return;

  _map = L.map('geo-map', {
    center: PERU_CENTER,
    zoom: PERU_ZOOM,
    zoomControl: true,
    minZoom: 3,
    maxZoom: 20
  });

  _markersLayer = L.layerGroup().addTo(_map);
  _routeLayer = L.layerGroup().addTo(_map);

  switchBasemap(_currentBasemap);

  // Escuchar clics en el mapa para dibujo o edición interactiva
  _map.on('click', handleMapClick);

  setTimeout(() => { if (_map) _map.invalidateSize(); }, 200);
  setTimeout(() => { if (_map) _map.invalidateSize(); }, 600);

  // Verificar si hay salto programado o solicitud de dibujo/edición
  checkPendingActions();
}

function checkPendingActions() {
  const jumpTarget = sessionStorage.getItem('qubira_dst_jump_target');
  if (jumpTarget) {
    sessionStorage.removeItem('qubira_dst_jump_target');
    try {
      const { lat, lng, locId, userId } = JSON.parse(jumpTarget);
      setTimeout(() => {
        flyToLocation(lat, lng, locId, userId);
      }, 700);
    } catch (_) {}
  }

  const shouldDraw = sessionStorage.getItem('qubira_dst_activate_drawing');
  if (shouldDraw) {
    sessionStorage.removeItem('qubira_dst_activate_drawing');
    setTimeout(() => {
      startDrawingPerimeter();
    }, 500);
    return;
  }

  const shouldEdit = sessionStorage.getItem('qubira_dst_activate_editing');
  if (shouldEdit) {
    sessionStorage.removeItem('qubira_dst_activate_editing');
    setTimeout(() => {
      startEditingPerimeter();
    }, 500);
  }
}

async function loadData() {
  const listEl = document.getElementById('geo-logins-list');
  try {
    const [locationsRes, geofenceRes] = await Promise.all([
      Store.getLocations().catch(() => ({ locations: [], active: [] })),
      Store.getGeofence()
    ]);

    const simLocations = Store.getSimulatedLocations();
    _locationsData = [...simLocations, ...(locationsRes.locations || [])];
    _activeSessions = locationsRes.active || [];
    _geofence = geofenceRes;

    evaluatePerimeterContainment();

    // Actualizar KPIs
    const kpiTotal = document.getElementById('kpi-total-locations');
    const kpiUsers = document.getElementById('kpi-unique-users');
    const kpiOut = document.getElementById('kpi-out-of-bounds');
    const kpiSuspended = document.getElementById('kpi-suspended-users');

    if (kpiTotal) kpiTotal.textContent = _locationsData.length;
    if (kpiUsers) kpiUsers.textContent = new Set(_locationsData.map(l => l.usuario_id)).size;
    if (kpiOut) kpiOut.textContent = _outOfBoundsLocations.length;

    const suspendedCount = new Set(_locationsData.filter(l => l.usuario_estado === 'suspendido').map(l => l.usuario_id)).size;
    if (kpiSuspended) kpiSuspended.textContent = suspendedCount;

    renderPerimeterOnMap();
    renderLoginsList();
    updateMapLayers();

    // Centrar suavemente en los puntos o en el perímetro si existe
    if (_locationsData.length > 0 && _map && !_selectedUserId && !_isEditingMode && !_isDrawingMode) {
      setTimeout(() => {
        _map.invalidateSize();
        const validCoords = _locationsData
          .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)])
          .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));
        if (validCoords.length > 0) {
          const bounds = L.latLngBounds(validCoords);
          _map.fitBounds(bounds, { maxZoom: 15, padding: [60, 60] });
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

/**
 * Evalúa si cada punto de inicio de sesión cae dentro o fuera de la geocerca.
 */
function evaluatePerimeterContainment() {
  _outOfBoundsLocations = [];

  const hasPerimeter = _geofence && _geofence.points && _geofence.points.length >= 3;

  _locationsData.forEach(loc => {
    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    if (!hasPerimeter) {
      loc.isOutOfPerimeter = false;
      loc.riskLevel = 'NORMAL';
      loc.distanceOutKm = 0;
      return;
    }

    const inside = isPointInPolygon([lat, lng], _geofence.points);
    if (!inside) {
      loc.isOutOfPerimeter = true;
      loc.riskLevel = 'SOSPECHOSO ALTO';
      loc.distanceOutKm = distanceToPolygon([lat, lng], _geofence.points);
      _outOfBoundsLocations.push(loc);
    } else {
      loc.isOutOfPerimeter = false;
      loc.riskLevel = 'NORMAL';
      loc.distanceOutKm = 0;
    }
  });

  // Actualizar banners y botones de alertas
  updatePerimeterAlertUI();
}

function updatePerimeterAlertUI() {
  const count = _outOfBoundsLocations.length;
  const alertBanner = document.getElementById('geo-perimeter-alert-banner');
  const bannerCount = document.getElementById('banner-out-count');
  const alertCountPill = document.getElementById('btn-alert-count-pill');
  const filterBadgeOut = document.getElementById('filter-badge-out');
  const clearBtn = document.getElementById('btn-tool-clear-perimeter');
  const editBtn = document.getElementById('btn-tool-edit-perimeter');
  const toggleBtn = document.getElementById('btn-tool-toggle-perimeter');

  if (alertBanner) {
    alertBanner.style.display = count > 0 ? 'flex' : 'none';
  }
  if (bannerCount) bannerCount.textContent = count;
  if (alertCountPill) alertCountPill.textContent = count;
  if (filterBadgeOut) filterBadgeOut.textContent = count;

  // Actualizar contador del menú lateral en index.html
  const navAlertCounter = document.getElementById('nav-alert-counter');
  if (navAlertCounter) {
    navAlertCounter.textContent = count;
    navAlertCounter.style.display = count > 0 ? 'inline-block' : 'none';
  }

  const hasPerimeter = _geofence && _geofence.points && _geofence.points.length >= 3;
  if (clearBtn) clearBtn.style.display = hasPerimeter ? 'inline-flex' : 'none';
  if (editBtn) editBtn.style.display = hasPerimeter ? 'inline-flex' : 'none';
  if (toggleBtn) {
    toggleBtn.textContent = _showPerimeter ? '🛡️ Ocultar Zona' : '🛡️ Mostrar Zona';
  }
}

/**
 * Renderiza el polígono de la geocerca corporativa en el mapa.
 */
function renderPerimeterOnMap() {
  if (!_map) return;

  if (_geofenceLayer) {
    try { _map.removeLayer(_geofenceLayer); } catch (_) {}
    _geofenceLayer = null;
  }

  if (!_showPerimeter || !_geofence || !_geofence.points || _geofence.points.length < 3 || _isEditingMode || _isDrawingMode) {
    return;
  }

  try {
    _geofenceLayer = L.polygon(_geofence.points, {
      color: '#10b981',
      weight: 3,
      opacity: 0.9,
      dashArray: '6, 6',
      fillColor: '#10b981',
      fillOpacity: 0.14
    }).addTo(_map);

    const centroid = calculateCentroid(_geofence.points);
    const areaKm2 = calculatePolygonAreaKm2(_geofence.points).toFixed(1);

    _geofenceLayer.bindTooltip(`
      <div style="font-size:12px;font-weight:700;color:#065f46;">
        🛡️ ${escapeHtml(_geofence.name || 'Perímetro Corporativo Autorizado')}<br>
        <span style="font-size:10.5px;font-weight:normal;color:#047857;">Área autorizada: ~${areaKm2} km² · ${_geofence.points.length} vértices (Clic en "Editar" para modificar)</span>
      </div>
    `, { permanent: false, sticky: true });

  } catch (err) {
    console.error('[GEO] Error renderizando perímetro:', err);
  }
}

function togglePerimeter() {
  _showPerimeter = !_showPerimeter;
  renderPerimeterOnMap();
  updatePerimeterAlertUI();
  toast(_showPerimeter ? 'Zona segura visible en el mapa' : 'Zona segura oculta', 'info');
}

/**
 * ============================================================
 * MODO DIBUJO INTERACTIVO DE PERÍMETRO DESDE CERO
 * ============================================================
 */
function startDrawingPerimeter() {
  if (!_map) return;
  if (_isEditingMode) exitEditingMode();

  _isDrawingMode = true;
  _drawingPoints = [];

  // Ocultar capa actual mientras se dibuja
  if (_geofenceLayer) {
    try { _map.removeLayer(_geofenceLayer); } catch (_) {}
  }

  clearDrawingLayers();

  const bar = document.getElementById('geo-drawing-bar');
  if (bar) bar.style.display = 'flex';

  const editBar = document.getElementById('geo-editing-bar');
  if (editBar) editBar.style.display = 'none';

  const countEl = document.getElementById('draw-point-count');
  if (countEl) countEl.textContent = '0';

  const mapEl = document.getElementById('geo-map');
  if (mapEl) mapEl.style.cursor = 'crosshair';

  toast('🟢 Modo Dibujo Activo: Haz clic en el mapa para marcar los vértices del nuevo perímetro.', 'info');
}

function handleMapClick(e) {
  if (!_map) return;

  if (_isDrawingMode) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    _drawingPoints.push([lat, lng]);
    updateDrawingVisuals();
    return;
  }

  if (_isEditingMode) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    _editingPoints.push([lat, lng]);
    pushEditingHistory();
    renderEditingVisuals();
    toast(`Vértice #${_editingPoints.length} agregado al perímetro`, 'info');
    return;
  }
}

function updateDrawingVisuals() {
  if (!_map) return;

  const countEl = document.getElementById('draw-point-count');
  if (countEl) countEl.textContent = _drawingPoints.length;

  clearDrawingLayers();

  _drawingPoints.forEach((pt, index) => {
    const marker = L.circleMarker(pt, {
      radius: 6,
      fillColor: '#10b981',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(_map);

    marker.bindTooltip(`Vértice #${index + 1}`, { permanent: false });
    _drawingMarkers.push(marker);
  });

  if (_drawingPoints.length >= 2) {
    _drawingLine = L.polyline(_drawingPoints, {
      color: '#059669',
      weight: 3,
      dashArray: '5, 5',
      opacity: 0.95
    }).addTo(_map);
  }

  if (_drawingPoints.length >= 3) {
    _drawingPolygonPreview = L.polygon(_drawingPoints, {
      color: '#10b981',
      weight: 2,
      dashArray: '3, 4',
      fillColor: '#34d399',
      fillOpacity: 0.25
    }).addTo(_map);
  }
}

function undoDrawingPoint() {
  if (_drawingPoints.length === 0) return;
  _drawingPoints.pop();
  updateDrawingVisuals();
  toast('Último punto removido', 'info');
}

async function saveDrawingPerimeter() {
  if (_drawingPoints.length < 3) {
    toast('Se requieren al menos 3 puntos para delimitar un perímetro cerrado.', 'warning');
    return;
  }

  const newGeofence = {
    name: 'Perímetro Corporativo Autorizado',
    points: _drawingPoints,
    updated_at: new Date().toISOString(),
    active: true
  };

  try {
    await Store.saveGeofence(newGeofence);
    _geofence = newGeofence;
    _showPerimeter = true;
    exitDrawingMode();

    toast(`✅ ¡Perímetro seguro guardado exitosamente con ${_drawingPoints.length} vértices!`, 'success');
    loadData();
  } catch (err) {
    toast('Error al guardar el perímetro', 'error');
  }
}

function cancelDrawingPerimeter() {
  exitDrawingMode();
  renderPerimeterOnMap();
  toast('Dibujo de perímetro cancelado', 'info');
}

function exitDrawingMode() {
  _isDrawingMode = false;
  _drawingPoints = [];
  clearDrawingLayers();

  const bar = document.getElementById('geo-drawing-bar');
  if (bar) bar.style.display = 'none';

  const mapEl = document.getElementById('geo-map');
  if (mapEl) mapEl.style.cursor = '';
}

function clearDrawingLayers() {
  if (_map) {
    _drawingMarkers.forEach(m => { try { _map.removeLayer(m); } catch (_) {} });
    _drawingMarkers = [];
    if (_drawingLine) { try { _map.removeLayer(_drawingLine); } catch (_) {} _drawingLine = null; }
    if (_drawingPolygonPreview) { try { _map.removeLayer(_drawingPolygonPreview); } catch (_) {} _drawingPolygonPreview = null; }
  }
}

/**
 * ============================================================
 * MODO EDICIÓN INTERACTIVA DE VÉRTICES (ARRASTRAR / MODIFICAR)
 * ============================================================
 */
function startEditingPerimeter() {
  if (!_map) return;
  if (!_geofence || !_geofence.points || _geofence.points.length < 3) {
    toast('No hay un perímetro activo para editar. Dibuja uno nuevo.', 'warning');
    startDrawingPerimeter();
    return;
  }

  if (_isDrawingMode) exitDrawingMode();

  _isEditingMode = true;
  _editingPoints = _geofence.points.map(pt => [parseFloat(pt[0]), parseFloat(pt[1])]);
  _editingHistory = [JSON.stringify(_editingPoints)];

  if (_geofenceLayer) {
    try { _map.removeLayer(_geofenceLayer); } catch (_) {}
    _geofenceLayer = null;
  }

  const editBar = document.getElementById('geo-editing-bar');
  if (editBar) editBar.style.display = 'flex';

  const drawBar = document.getElementById('geo-drawing-bar');
  if (drawBar) drawBar.style.display = 'none';

  renderEditingVisuals();

  if (_editingPoints.length > 0) {
    const bounds = L.latLngBounds(_editingPoints);
    _map.fitBounds(bounds, { maxZoom: 16, padding: [60, 60] });
  }

  toast('✏️ Modo Edición Activo: Arrastra los círculos numerados para ajustar los vértices o clic en (+) para añadir puntos.', 'info');
}

function renderEditingVisuals() {
  if (!_map) return;

  const countEl = document.getElementById('edit-point-count');
  if (countEl) countEl.textContent = _editingPoints.length;

  clearEditingLayers();

  // 1. Polígono activo que se ajusta en tiempo real
  _editingPolygon = L.polygon(_editingPoints, {
    color: '#0284c7',
    weight: 3,
    dashArray: '5, 5',
    fillColor: '#38bdf8',
    fillOpacity: 0.22
  }).addTo(_map);

  // 2. Colocar marcadores arrastrables para cada vértice
  _editingPoints.forEach((pt, index) => {
    const customIcon = L.divIcon({
      className: 'geo-edit-vertex-wrapper',
      html: `
        <div class="geo-edit-vertex-pin" title="Vértice #${index + 1} (Arrastra para mover / clic para opciones)">
          ${index + 1}
        </div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker(pt, {
      draggable: true,
      icon: customIcon
    }).addTo(_map);

    // Evento de arrastre continuo
    marker.on('drag', (e) => {
      const pos = e.target.getLatLng();
      _editingPoints[index] = [pos.lat, pos.lng];
      if (_editingPolygon) {
        _editingPolygon.setLatLngs(_editingPoints);
      }
      updateMidpointPositions();
    });

    // Guardar en historial al soltar el vértice
    marker.on('dragend', () => {
      pushEditingHistory();
      renderEditingVisuals();
    });

    // Clic derecho para borrar vértice
    marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      promptDeleteVertex(index);
    });

    // Clic simple: opción directa de eliminar
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (_editingPoints.length > 3) {
        promptDeleteVertex(index);
      } else {
        toast(`Vértice #${index + 1}. No se puede eliminar (mínimo 3 requeridos).`, 'info');
      }
    });

    _editingMarkers.push(marker);
  });

  // 3. Colocar puntos intermedios (+) entre cada par de vértices para inserción fácil
  for (let i = 0; i < _editingPoints.length; i++) {
    const nextIdx = (i + 1) % _editingPoints.length;
    const pt1 = _editingPoints[i];
    const pt2 = _editingPoints[nextIdx];
    const midLat = (pt1[0] + pt2[0]) / 2;
    const midLng = (pt1[1] + pt2[1]) / 2;

    const midIcon = L.divIcon({
      className: 'geo-midpoint-wrapper',
      html: `<div class="geo-midpoint-pin" title="Haz clic para insertar un nuevo vértice aquí">+</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const midMarker = L.marker([midLat, midLng], { icon: midIcon }).addTo(_map);
    midMarker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      insertVertexAt(i + 1, [midLat, midLng]);
    });

    _editingMidpointMarkers.push(midMarker);
  }
}

function updateMidpointPositions() {
  if (_editingMidpointMarkers.length !== _editingPoints.length) return;
  for (let i = 0; i < _editingPoints.length; i++) {
    const nextIdx = (i + 1) % _editingPoints.length;
    const pt1 = _editingPoints[i];
    const pt2 = _editingPoints[nextIdx];
    const midLat = (pt1[0] + pt2[0]) / 2;
    const midLng = (pt1[1] + pt2[1]) / 2;
    _editingMidpointMarkers[i]?.setLatLng([midLat, midLng]);
  }
}

function insertVertexAt(index, latlng) {
  _editingPoints.splice(index, 0, latlng);
  pushEditingHistory();
  renderEditingVisuals();
  toast(`Nuevo vértice #${index + 1} insertado en el perímetro`, 'info');
}

function promptDeleteVertex(index) {
  if (_editingPoints.length <= 3) {
    toast('No se puede eliminar: el perímetro requiere como mínimo 3 vértices para ser un área cerrada.', 'warning');
    return;
  }
  _editingPoints.splice(index, 1);
  pushEditingHistory();
  renderEditingVisuals();
  toast(`Vértice #${index + 1} eliminado`, 'info');
}

function pushEditingHistory() {
  const currentStr = JSON.stringify(_editingPoints);
  if (_editingHistory[_editingHistory.length - 1] !== currentStr) {
    _editingHistory.push(currentStr);
    if (_editingHistory.length > 25) _editingHistory.shift();
  }
}

function undoEditingPerimeter() {
  if (_editingHistory.length <= 1) {
    toast('No hay más cambios previos para deshacer.', 'info');
    return;
  }
  _editingHistory.pop();
  _editingPoints = JSON.parse(_editingHistory[_editingHistory.length - 1]);
  renderEditingVisuals();
  toast('Cambio deshecho', 'info');
}

async function saveEditedPerimeter() {
  if (_editingPoints.length < 3) {
    toast('El perímetro requiere al menos 3 vértices para delimitar una zona.', 'warning');
    return;
  }

  const updatedGeofence = {
    name: _geofence?.name || 'Perímetro Corporativo Autorizado',
    points: _editingPoints,
    updated_at: new Date().toISOString(),
    active: true
  };

  try {
    await Store.saveGeofence(updatedGeofence);
    _geofence = updatedGeofence;
    _showPerimeter = true;
    exitEditingMode();

    toast(`✅ ¡Perímetro actualizado exitosamente con ${_editingPoints.length} vértices!`, 'success');
    loadData();
  } catch (err) {
    toast('Error al guardar el perímetro modificado', 'error');
  }
}

function cancelEditingPerimeter() {
  exitEditingMode();
  renderPerimeterOnMap();
  toast('Edición de perímetro cancelada (cambios descartados)', 'info');
}

function exitEditingMode() {
  _isEditingMode = false;
  _editingPoints = [];
  _editingHistory = [];
  clearEditingLayers();

  const bar = document.getElementById('geo-editing-bar');
  if (bar) bar.style.display = 'none';
}

function clearEditingLayers() {
  if (_map) {
    _editingMarkers.forEach(m => { try { _map.removeLayer(m); } catch (_) {} });
    _editingMarkers = [];
    _editingMidpointMarkers.forEach(m => { try { _map.removeLayer(m); } catch (_) {} });
    _editingMidpointMarkers = [];
    if (_editingPolygon) {
      try { _map.removeLayer(_editingPolygon); } catch (_) {}
      _editingPolygon = null;
    }
  }
}

async function promptClearPerimeter() {
  const ok = await confirmDialog('¿Deseas eliminar el perímetro seguro actual? Al eliminarlo, ya no se generarán alertas automáticas de "Sospechoso Alto" por ubicación.', {
    title: 'Borrar Perímetro Seguro',
    confirmLabel: 'Borrar Perímetro',
    danger: true
  });

  if (!ok) return;

  try {
    await Store.deleteGeofence();
    _geofence = null;
    if (_geofenceLayer && _map) {
      try { _map.removeLayer(_geofenceLayer); } catch (_) {}
      _geofenceLayer = null;
    }
    toast('Perímetro eliminado', 'success');
    loadData();
  } catch (err) {
    toast('Error al eliminar perímetro', 'error');
  }
}

function getFilteredLocations() {
  let list = [..._locationsData];

  // Filtro por período o infracción de perímetro
  if (_periodFilter === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    list = list.filter(l => (l.created_at || '').slice(0, 10) === today);
  } else if (_periodFilter === 'active') {
    const activeUserIds = new Set(_activeSessions.map(s => s.usuario_id));
    list = list.filter(l => activeUserIds.has(l.usuario_id));
  } else if (_periodFilter === 'out_of_bounds') {
    list = list.filter(l => l.isOutOfPerimeter);
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
  _markersById = {};

  // 1. Capa de calor (Heatmap)
  if (_heatLayer) {
    _map.removeLayer(_heatLayer);
    _heatLayer = null;
  }

  if ((_activeMode === 'heat' || _activeMode === 'hybrid') && typeof L.heatLayer === 'function') {
    const heatPoints = filtered.map(l => [
      parseFloat(l.latitude),
      parseFloat(l.longitude),
      0.75
    ]);

    if (heatPoints.length > 0) {
      _heatLayer = L.heatLayer(heatPoints, {
        radius: 20,
        blur: 14,
        maxZoom: 18,
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

  // 2. Capa de marcadores y círculos de precisión GPS
  if (!_markersLayer && _map) {
    _markersLayer = L.layerGroup().addTo(_map);
  }
  if (!_routeLayer && _map) {
    _routeLayer = L.layerGroup().addTo(_map);
  }

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
      const isOut = loc.isOutOfPerimeter;
      const accuracy = Math.round(loc.accuracy || 0);

      // Círculo de precisión GPS
      const accRadius = Math.max(accuracy, 12);
      const circleColor = isOut ? '#dc2626' : (isSuspended ? '#ef4444' : (isActiveSession ? '#10b981' : '#3b82f6'));

      const accuracyCircle = L.circle([lat, lng], {
        radius: accRadius,
        color: circleColor,
        fillColor: circleColor,
        fillOpacity: isOut ? 0.22 : 0.12,
        weight: isOut ? 2 : 1,
        dashArray: isOut ? '2, 3' : '3, 4'
      });
      if (_markersLayer) {
        _markersLayer.addLayer(accuracyCircle);
      }

      // Marcador de Leaflet con estilo dinámico
      let pinClass = '';
      if (isOut) {
        pinClass = 'out-of-bounds';
      } else if (isSuspended) {
        pinClass = 'suspended';
      } else if (isActiveSession) {
        pinClass = 'active-session';
      }

      const customIcon = L.divIcon({
        className: 'geo-marker-wrapper',
        html: `
          <div class="geo-marker-pin ${pinClass}">
            <div class="geo-marker-pulse"></div>
            ${isOut ? `<div class="geo-marker-warn-badge">⚠️</div>` : ''}
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const initials = ((loc.nombre?.[0] || loc.username?.[0] || '?') + (loc.apellidos?.[0] || '')).toUpperCase();

      let accBadgeHtml = '';
      if (accuracy > 0) {
        if (accuracy <= 30) {
          accBadgeHtml = `<span class="geo-acc-badge excelente">±${accuracy}m · Alta precisión</span>`;
        } else if (accuracy <= 150) {
          accBadgeHtml = `<span class="geo-acc-badge aceptable">±${accuracy}m · Precisión media</span>`;
        } else {
          accBadgeHtml = `<span class="geo-acc-badge aproximado">±${accuracy}m · Red/WiFi</span>`;
        }
      }

      const popupHtml = `
        <div class="geo-popup-wrap">
          <div class="geo-popup-content">
            ${isOut ? `
              <div class="geo-popup-alert-header">
                <span class="pulsing-red-dot"></span>
                <strong>🚨 ALERTA: SOSPECHOSO ALTO</strong>
                <div style="font-size:11px;font-weight:normal;margin-top:2px;color:#fee2e2;">
                  Inicio reportado fuera del perímetro (+${loc.distanceOutKm.toFixed(1)} km del límite)
                </div>
              </div>
            ` : ''}

            <div class="geo-popup-header">
              <div class="geo-card-avatar" style="${isOut ? 'background:#fee2e2;color:#b91c1c;' : 'background:#3b82f6;color:#fff;'}">${initials}</div>
              <div>
                <strong style="color:#fff;font-size:13px;display:block;">${escapeHtml(loc.nombre || loc.username)} ${escapeHtml(loc.apellidos || '')}</strong>
                <span style="color:#94a3b8;font-size:11.5px;">@${escapeHtml(loc.username)} · ${escapeHtml(loc.rol || loc.area || 'Usuario')}</span>
              </div>
            </div>

            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">📍 Coordenadas:</span> <strong style="color:#e2e8f0;">${lat.toFixed(6)}, ${lng.toFixed(6)}</strong>
            </div>
            <div style="margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">
              <span style="color:#94a3b8;">🎯 Margen GPS:</span>
              ${accBadgeHtml || `<strong style="color:#e2e8f0;">±${accuracy}m</strong>`}
            </div>
            <div style="margin-bottom:6px;" id="popup-addr-wrap-${loc.id}">
              <span style="color:#94a3b8;">🗺️ Ubicación:</span>
              <strong style="color:#38bdf8; display:block; font-size:11.5px;" id="popup-addr-${loc.id}">
                ${escapeHtml(loc.address || 'Consultando calle...')}
              </strong>
            </div>
            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">🌐 IP de Acceso:</span> <strong style="color:#e2e8f0;">${escapeHtml(loc.ip_address || 'No registrada')}</strong>
            </div>
            <div style="margin-bottom:6px;">
              <span style="color:#94a3b8;">⏰ Fecha de Login:</span> <strong style="color:#e2e8f0;">${formatDateTime(loc.created_at)}</strong>
            </div>
            <div style="margin-bottom:8px;">
              <span style="color:#94a3b8;">🛡️ Estado de Cuenta:</span>
              <span class="geo-card-status ${isSuspended ? 'suspendido' : 'activo'}">${isSuspended ? 'Suspendido' : (isActiveSession ? 'Activo (En vivo)' : 'Registrado')}</span>
            </div>

            <div class="geo-popup-actions">
              <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="geo-btn-action btn-gmaps" title="Abrir en Google Maps / Street View">
                📍 Google Maps
              </a>
              <button class="geo-btn-action btn-fly" onclick="window.traceUserRoute(${loc.usuario_id}, '${escapeHtml(loc.username)}')">
                🧭 Recorrido
              </button>
              ${isSuspended
                ? `<button class="geo-btn-action btn-unsuspend" onclick="window.quickUnsuspendUser(${loc.usuario_id})">✓ Reactivar</button>`
                : `<button class="geo-btn-action btn-suspend" onclick="window.quickSuspendUser(${loc.usuario_id}, '${escapeHtml(loc.username)}', ${lat}, ${lng})">🚫 Suspender</button>`
              }
              ${isOut ? `
                <button class="geo-btn-action" style="grid-column: span 2; background:#fee2e2; color:#b91c1c; border-color:#fca5a5; font-weight:700;" onclick="window.navigateToView('alertas-perimetrales')">
                  📄 Abrir en Reporte Forense ➔
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      const marker = L.marker([lat, lng], { icon: customIcon });
      marker.bindPopup(popupHtml, { maxWidth: 340 });

      marker.on('popupopen', () => {
        resolveAddress(lat, lng, loc.id, loc.address);
      });

      if (_markersLayer) {
        _markersLayer.addLayer(marker);
      }
      _markersById[loc.id] = marker;
    });
  }
}

function resolveAddress(lat, lng, locId, existingAddr) {
  if (existingAddr) return;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const popupAddrEl = document.getElementById(`popup-addr-${locId}`);
  const cardAddrEl = document.getElementById(`card-addr-${locId}`);

  if (_addressCache[key]) {
    if (popupAddrEl) popupAddrEl.textContent = _addressCache[key];
    if (cardAddrEl) cardAddrEl.textContent = _addressCache[key];
    return;
  }

  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.display_name) {
        _addressCache[key] = data.display_name;
        if (popupAddrEl) popupAddrEl.textContent = data.display_name;
        if (cardAddrEl) cardAddrEl.textContent = data.display_name;
      } else {
        if (popupAddrEl) popupAddrEl.textContent = 'Dirección no disponible';
      }
    })
    .catch(() => {
      if (popupAddrEl) popupAddrEl.textContent = 'Ubicación registrada';
    });
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
    const isOut = loc.isOutOfPerimeter;
    const initials = ((loc.nombre?.[0] || loc.username?.[0] || '?') + (loc.apellidos?.[0] || '')).toUpperCase();
    const accuracy = Math.round(loc.accuracy || 0);
    const timeAgo = getTimeAgo(loc.created_at);

    return `
      <div class="geo-card ${isSelected ? 'selected' : ''} ${isOut ? 'out-of-bounds-card' : ''}" id="geocard-${loc.id}" onclick="window.flyToLocation(${lat}, ${lng}, '${loc.id}', ${loc.usuario_id})">
        ${isOut ? `
          <div class="card-out-of-bounds-tag">
            <span class="pulsing-red-dot"></span>
            <strong>🚨 SOSPECHOSO ALTO</strong> · Fuera de Perímetro (+${loc.distanceOutKm.toFixed(1)} km)
          </div>
        ` : ''}

        <div class="geo-card-head">
          <div class="geo-card-user">
            <div class="geo-card-avatar" style="${isOut ? 'background:#fee2e2;color:#b91c1c;' : (isActiveSession ? 'background:#ecfdf5;color:#059669;' : '')}">
              ${initials}
            </div>
            <div>
              <div class="geo-card-name">${escapeHtml(loc.nombre || loc.username)} ${escapeHtml(loc.apellidos || '')}</div>
              <div class="geo-card-username">@${escapeHtml(loc.username)} · ${escapeHtml(loc.rol || loc.area || 'Usuario')}</div>
            </div>
          </div>

          <span class="geo-card-status ${isSuspended ? 'suspendido' : (isOut ? 'sospechoso-alto' : 'activo')}">
            ${isSuspended ? 'Suspendido' : (isOut ? 'Sospechoso Alto' : (isActiveSession ? 'Activo (En vivo)' : 'Registrado'))}
          </span>
        </div>

        <div class="geo-card-details">
          <div><strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)} <span style="color:#059669;font-weight:600;">(±${accuracy}m)</span></div>
          ${loc.address ? `<div style="color:#475569;font-size:11px;margin:2px 0;">📍 ${escapeHtml(loc.address)}</div>` : `<div style="color:#64748b;font-size:11px;margin:2px 0;" id="card-addr-${loc.id}"></div>`}
          <div><strong>IP:</strong> ${escapeHtml(loc.ip_address || '-')} · <strong>Hora:</strong> ${timeAgo} (${formatDateTime(loc.created_at)})</div>
        </div>

        <div class="geo-card-actions" onclick="event.stopPropagation()">
          <button class="geo-btn-action btn-fly" onclick="window.flyToLocation(${lat}, ${lng}, '${loc.id}', ${loc.usuario_id})" title="Centrar mapa en este acceso">
            <svg class="icon" style="width:13px;height:13px;"><use href="#icon-map-pin"></use></svg>
            Centrar
          </button>

          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="geo-btn-action btn-gmaps" title="Abrir en Google Maps / Street View">
            📍 Maps
          </a>

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

function flyToLocation(lat, lng, locId, userId) {
  _selectedUserId = userId;
  document.querySelectorAll('.geo-card').forEach(c => c.classList.remove('selected'));
  if (locId) {
    const card = document.getElementById(`geocard-${locId}`);
    if (card) {
      card.classList.add('selected');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  if (_map && !isNaN(lat) && !isNaN(lng)) {
    _map.flyTo([lat, lng], 18, { duration: 1.2 });

    setTimeout(() => {
      if (locId && _markersById[locId]) {
        _markersById[locId].openPopup();
      }
    }, 1300);
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
      _map.flyTo(pt, 18, { duration: 1 });
      toast(`@${username} tiene un único punto registrado en el mapa.`, 'info');
      return;
    }

    const latLngs = history.map(h => [parseFloat(h.latitude), parseFloat(h.longitude)]);

    const polyline = L.polyline(latLngs, {
      color: '#4f46e5',
      weight: 4,
      opacity: 0.85,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(_routeLayer);

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
        <textarea name="motivo" rows="3" class="input" style="width:100%;font-size:12.5px;padding:8px;" required>Acceso detectado en ubicación geográfica no autorizada o fuera del perímetro seguro.</textarea>
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
