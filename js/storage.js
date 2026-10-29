// Capa de acceso a la API centralizada de QUBIRA (API_QUBIRA) — DST no
// tiene backend propio, consume /api/security/* y /api/audit/* de esa
// misma API (ver el plan: "QUBIRA_DST NO será un backend separado").

const QD_API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : 'https://api-qubira.onrender.com';
const QD_ALERT_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:5515/session-alert.html'
  : 'https://qubira-login.vercel.app/session-alert.html';

function qdToken() { return localStorage.getItem('dst_token') || null; }

async function qdFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = qdToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(QD_API_BASE + path, { ...opts, headers });

  if (res.status === 401) {
    const data401 = await res.json().catch(() => ({}));
    const cachedUsername = JSON.parse(localStorage.getItem('dst_user') || 'null')?.username;
    localStorage.removeItem('dst_token');
    localStorage.removeItem('dst_user');
    if (data401?.code === 'SESSION_REPLACED') {
      window.location.href = `${QD_ALERT_URL}?username=${encodeURIComponent(cachedUsername || '')}&ip=${encodeURIComponent(data401.ip || '')}`;
    } else {
      window.location.href = 'login.html';
    }
    throw new Error('SESSION_EXPIRED');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Error ' + res.status));
  return data;
}

function qs(params = {}) {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const s = new URLSearchParams(usable).toString();
  return s ? '?' + s : '';
}

export const Store = {
  // Heartbeat de sesión — sin datos propios, solo para que qdFetch
  // detecte a tiempo si esta cuenta inició sesión en otro dispositivo.
  ping: () => qdFetch('/api/auth/me'),

  // Usuarios
  getUsers: (q) => qdFetch('/api/security/users' + qs({ q })),

  // Permisos
  getGrantedModules: (userId) => qdFetch(`/api/security/permissions/${userId}`),
  setGrantedModules: (userId, modules) => qdFetch(`/api/security/permissions/${userId}`, { method: 'POST', body: JSON.stringify({ modules }) }),
  getPermissionHistory: (userId) => qdFetch(`/api/security/permissions/${userId}/history`),

  // Suspensión / bloqueo
  suspendUser: (userId, motivo) => qdFetch(`/api/security/users/${userId}/suspend`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  unsuspendUser: (userId) => qdFetch(`/api/security/users/${userId}/unsuspend`, { method: 'POST' }),
  unlockUser: (userId) => qdFetch(`/api/security/users/${userId}/unlock`, { method: 'POST' }),

  // Bloqueos de 2FA — racha actual + historial de vida por cuenta
  getTotpLockouts: () => qdFetch('/api/security/totp-lockouts'),
  getTotpLockoutHistory: (userId) => qdFetch(`/api/security/totp-lockouts/${userId}/history`),
  getTotpCompliance: (params) => qdFetch('/api/security/totp-compliance' + qs(params)),

  // Sesiones
  getSessions: () => qdFetch('/api/security/sessions'),
  revokeSession: (id) => qdFetch(`/api/security/sessions/${id}`, { method: 'DELETE' }),
  revokeAllSessions: (userId) => qdFetch(`/api/security/sessions/by-user/${userId}`, { method: 'DELETE' }),
  getLoginHistory: (username, days) => qdFetch(`/api/security/login-history/${encodeURIComponent(username)}` + qs({ days })),

  // IP
  getIps: (params) => qdFetch('/api/security/ips' + qs(params)),
  updateIp: (ip, payload) => qdFetch(`/api/security/ips/${encodeURIComponent(ip)}`, { method: 'PUT', body: JSON.stringify(payload) }),

  // Auditoría (comparte /api/audit/logs con los 4 paneles)
  getAuditLogs: (params) => qdFetch('/api/audit/logs' + qs(params)),

  // Geolocalización y mapa de calor
  getLocations: () => qdFetch('/api/security/locations'),
  getUserLocationHistory: (userId) => qdFetch(`/api/security/locations/history/${userId}`),

  // Geocercas y Perímetro de Seguridad
  getGeofence: async () => {
    // Intentar leer de la API primero si está disponible
    try {
      const data = await qdFetch('/api/security/geofence');
      if (data && data.ok && data.geofence) {
        localStorage.setItem('qubira_dst_geofence', JSON.stringify(data.geofence));
        return data.geofence;
      }
    } catch (_) {}
    // Fallback instantáneo a almacenamiento local persistente
    const local = localStorage.getItem('qubira_dst_geofence');
    return local ? JSON.parse(local) : null;
  },

  saveGeofence: async (geofenceData) => {
    localStorage.setItem('qubira_dst_geofence', JSON.stringify(geofenceData));
    try {
      await qdFetch('/api/security/geofence', {
        method: 'POST',
        body: JSON.stringify(geofenceData)
      });
    } catch (_) {}
    return geofenceData;
  },

  deleteGeofence: async () => {
    localStorage.removeItem('qubira_dst_geofence');
    try {
      await qdFetch('/api/security/geofence', { method: 'DELETE' });
    } catch (_) {}
    return true;
  },

  // Simulación para pruebas en vivo de alertas perimetrales
  getSimulatedLocations: () => {
    try {
      return JSON.parse(localStorage.getItem('qubira_dst_simulated_locations') || '[]');
    } catch (_) { return []; }
  },

  addSimulatedLocation: (simLoc) => {
    const list = Store.getSimulatedLocations();
    list.unshift(simLoc);
    localStorage.setItem('qubira_dst_simulated_locations', JSON.stringify(list.slice(0, 50)));
    return list;
  },

  clearSimulatedLocations: () => {
    localStorage.removeItem('qubira_dst_simulated_locations');
  },

  // Dashboard y amenazas
  getDashboard: () => qdFetch('/api/security/dashboard'),
  // Control de almacenamiento (Neon + Cloudinary)
  getStorageNeon: () => qdFetch('/api/security/storage/neon'),
  getStorageCloudinary: (params) => qdFetch('/api/security/storage/cloudinary' + qs(params)),
  getStorageHistory: (days) => qdFetch('/api/security/storage/history' + qs({ days })),
  getThreats: () => qdFetch('/api/security/threats'),
  getLoginsToday: () => qdFetch('/api/security/logins-today'),

  // Visitas — historial e interacciones del sitio público QUBIRA
  getAnalyticsSummary: (days) => qdFetch('/api/analytics/summary' + qs({ days })),
  getAnalyticsSessions: (params) => qdFetch('/api/analytics/sessions' + qs(params)),
  getSessionTimeline: (sessionId) => qdFetch(`/api/analytics/sessions/${encodeURIComponent(sessionId)}/timeline`),
  getAnalyticsEvents: (params) => qdFetch('/api/analytics/events' + qs(params)),

  // Calendario Corporativo — fuente central de reuniones compartida entre
  // RR.HH., ADG, TI, Soporte y DST (API/src/routes/calendar.js).
  getMeetings: (params = {}) => qdFetch('/api/calendar/meetings' + qs(params)),
  checkAvailability: (payload) => qdFetch('/api/calendar/check-availability', { method: 'POST', body: JSON.stringify(payload) }),
  addMeeting: (payload) => qdFetch('/api/calendar/meetings', { method: 'POST', body: JSON.stringify(payload) }),
  updateMeeting: (id, payload) => qdFetch(`/api/calendar/meetings/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  cancelMeeting: (id) => qdFetch(`/api/calendar/meetings/${id}/cancel`, { method: 'POST' }),
  deleteMeeting: (id) => qdFetch(`/api/calendar/meetings/${id}`, { method: 'DELETE' }),
  searchDirectory: (params = {}) => qdFetch('/api/calendar/directory' + qs(params)),
  // Imagen opcional de una reunión (sube a Cloudinary vía la API; el
  // body es FormData, no debe llevar Content-Type: application/json,
  // así que no pasa por qdFetch).
  uploadMeetingImage: async (file) => {
    const token = qdToken();
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch(QD_API_BASE + '/api/calendar/meetings/image', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: fd,
    });
    if (res.status === 401) {
      localStorage.removeItem('dst_token');
      localStorage.removeItem('dst_user');
      window.location.href = 'login.html';
      throw new Error('SESSION_EXPIRED');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Error ' + res.status));
    return data.url;
  },
};
