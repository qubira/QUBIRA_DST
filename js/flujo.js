/* Flujo de proyectos: DST devuelve a OTI y lleva riesgos de seguridad (componente compartido de la API) */
export function renderFlujo() {
  const c = document.getElementById('view-flujo');
  const dibujar = () => window.qbFlujo.lista(c, { token: () => localStorage.getItem('dst_token') });
  if (window.qbFlujo) return dibujar();
  c.innerHTML = '<div class="empty-state"><p>Cargando el flujo de proyectos…</p></div>';
  document.addEventListener('qb-flujo-listo', dibujar, { once: true });
}
