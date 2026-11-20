/* Pendientes de revisar o aprobar (actas de seguridad DST-ACT y otros documentos):
   lo dibuja la bandeja compartida de la API, la misma que usan los demás módulos. */
export function renderPendientes() {
  const c = document.getElementById('view-pendientes');
  const dibujar = () => window.qbBandeja.render(c, { token: () => localStorage.getItem('dst_token') });
  if (window.qbBandeja) return dibujar();
  c.innerHTML = '<div class="empty-state"><p>Cargando tus pendientes…</p></div>';
  document.addEventListener('qb-bandeja-lista', dibujar, { once: true });
}
