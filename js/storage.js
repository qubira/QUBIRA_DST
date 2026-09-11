// Capa de acceso a la API centralizada de QUBIRA (API_QUBIRA) — DST no
// tiene backend propio, consume /api/security/* y /api/audit/* de esa
// misma API (ver el plan: "QUBIRA_DST NO será un backend separado").

const QD_API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : 'https://api-qubira.onrender.com';

function qdToken() { return localStorage.getItem('dst_token') || null; }

async function qdFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = qdToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(QD_API_BASE + path, { ...opts, headers });

  if (res.status === 401) {
    localStorage.removeItem('dst_token');
    localStorage.removeItem('dst_user');
    window.location.href = 'login.html';
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

  // Dashboard y amenazas
  getDashboard: () => qdFetch('/api/security/dashboard'),
  getThreats: () => qdFetch('/api/security/threats'),
  getLoginsToday: () => qdFetch('/api/security/logins-today'),

  // Visitas — historial e interacciones del sitio público QUBIRA
  getAnalyticsSummary: (days) => qdFetch('/api/analytics/summary' + qs({ days })),
  getAnalyticsEvents: (params) => qdFetch('/api/analytics/events' + qs(params)),
};
