/* Incidentes de seguridad reportados por OCOS (componente compartido de la API) */
export function renderCasos() {
  const c = document.getElementById('view-casos');
  const dibujar = () => window.qbCasos.render(c, { token: () => localStorage.getItem('dst_token') });
  if (window.qbCasos) return dibujar();
  c.innerHTML = '<div class="empty-state"><p>Cargando los incidentes…</p></div>';
  document.addEventListener('qb-casos-listo', dibujar, { once: true });
}
