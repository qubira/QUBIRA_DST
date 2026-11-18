/* Mapa jerárquico de QUBIRA: lo dibuja el componente compartido de la API
   (mismo mapa que ven DST y ADG), con los cargos del catálogo de ORH. */
export function renderJerarquia() {
  const c = document.getElementById('view-jerarquia');
  const dibujar = () => window.qbJerarquia.render(c);
  if (window.qbJerarquia) return dibujar();
  c.innerHTML = '<div class="empty-state"><p>Cargando el mapa jerárquico…</p></div>';
  document.addEventListener('qb-jerarquia-lista', dibujar, { once: true });
}
