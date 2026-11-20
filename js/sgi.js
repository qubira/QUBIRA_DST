/* Sistema de gestión: mapa de riesgos (ISO 31000), revisión por la dirección y normas ISO (componente compartido de la API) */
export function renderSgi() {
  const c = document.getElementById('view-sgi');
  const dibujar = () => window.qbSgi.render(c, { token: () => localStorage.getItem('dst_token') });
  if (window.qbSgi) return dibujar();
  c.innerHTML = '<div class="empty-state"><p>Cargando el sistema de gestión…</p></div>';
  document.addEventListener('qb-sgi-listo', dibujar, { once: true });
}
