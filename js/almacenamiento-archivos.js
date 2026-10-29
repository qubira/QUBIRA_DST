// Explorador de archivos de Cloudinary: qué es cada archivo, dónde se usa
// en QUBIRA y eliminación definitiva protegida con el código 2FA.
import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast } from './ui.js';

// Qué es cada esquema de la base (también se usa en las «i» de la vista)
export const MODULOS = {
  audit: ['Auditoría', 'Registro de cada acción de los usuarios en todos los paneles (quién hizo qué y cuándo). Crece con el uso diario; por eso suele ser lo que más pesa.'],
  ti: ['OTI / ADG', 'Proyectos, tareas, sprints, documentos y contratos de proyectos, catálogo de tecnologías, Tech Stacks y su actividad.'],
  security: ['Seguridad (DST)', 'Sesiones, intentos de inicio de sesión, IPs, bloqueos 2FA, geolocalización y las fotos del control de almacenamiento.'],
  odacl: ['ODACL', 'Documentos legales, plantillas oficiales, información societaria, contratos externos, consultas legales y matriz de riesgos.'],
  public: ['Núcleo del sistema', 'Usuarios, cuentas, módulos autorizados y datos compartidos por todos los paneles.'],
  rrhh: ['RR. HH.', 'Trabajadores, áreas, cargos, contratos laborales, constancias y catálogos de personal.'],
  comercial: ['Comercial (ODN)', 'Clientes, representantes, proformas y sus versiones, y contratos comerciales.'],
  calendar: ['Calendario corporativo', 'Reuniones de todas las áreas y sus participantes.'],
  analytics: ['Visitas del sitio', 'Sesiones y eventos de navegación del sitio público de QUBIRA.'],
  opp: ['OPP / Finanzas', 'Presupuestos y costos de la Oficina de Presupuestos y Planeación.'],
  soporte: ['Soporte (OCOS)', 'Tickets y atención de la mesa de ayuda.'],
};
export const nombreModulo = e => MODULOS[e]?.[0] || e;

const MB = 1048576;
function tam(b) {
  b = Number(b || 0);
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= MB) return (b / MB).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}
const TIPOS = { image: 'Imágenes', raw: 'Documentos', video: 'Videos' };
const TIPO_UNO = { image: 'Imagen', raw: 'Documento', video: 'Video' };

const ex = { archivos: [], cargando: false, error: null, tipo: '', q: '', carpeta: '', uso: '', orden: 'peso', sel: new Set(), detalle: null, generado: null, alEliminar: null };

// Origen del archivo: QUBIRA, ejemplos de Cloudinary u otra app de la misma cuenta
function origen(a) {
  const raiz = String(a.public_id).split('/')[0];
  if (raiz === 'samples' || /^cld-sample/.test(raiz) || raiz === 'sample') return 'ejemplo';
  if (raiz === 'qubira') return 'qubira';
  return String(a.public_id).includes('/') ? 'otra' : 'qubira';
}
function estadoUso(a) {
  const reales = a.usos.filter(u => !u.auditoria);
  if (reales.length) return ['uso', `En uso · ${reales.length}`, 'green'];
  if (a.usos.length) return ['auditoria', 'Solo en auditoría', 'gray'];
  const o = origen(a);
  if (o === 'ejemplo') return ['ejemplo', 'Ejemplo de Cloudinary', 'amber'];
  if (o === 'otra') return ['otra', 'De otra app', 'blue'];
  return ['libre', 'Sin uso en QUBIRA', 'amber'];
}

export async function abrirExplorador({ tipo = '', carpeta = '', publicId = '', alEliminar } = {}) {
  ex.tipo = tipo; ex.carpeta = carpeta; ex.q = ''; ex.uso = ''; ex.sel = new Set(); ex.detalle = null; ex.alEliminar = alEliminar;
  estilos();
  let ov = document.getElementById('arch-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'arch-overlay';
    ov.className = 'arch-overlay';
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) cerrar(); });
    document.addEventListener('keydown', teclas);
  }
  pintar();
  if (!ex.archivos.length) await cargar(false);
  if (publicId) { ex.detalle = publicId; pintar(); }
}
function teclas(e) {
  if (e.key !== 'Escape') return;
  if (document.getElementById('arch-dlg')) { document.getElementById('arch-dlg').remove(); return; }
  if (ex.detalle) { ex.detalle = null; pintar(); return; }
  cerrar();
}
function cerrar() {
  document.getElementById('arch-overlay')?.remove();
  document.removeEventListener('keydown', teclas);
}

// Nombre legible: sin el código interno (uuid_) que se antepone al subir
const legible = n => String(n || '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '');

async function cargar(forzar) {
  ex.cargando = true; ex.error = null; pintar();
  try {
    const r = await Store.getStorageArchivos(forzar);
    ex.archivos = (r.archivos || []).map(a => ({ ...a, nombre: legible(a.nombre) || a.nombre })); ex.generado = r.usos_calculados || r.generado;
  } catch (e) { if (e.message !== 'SESSION_EXPIRED') ex.error = e.message; }
  ex.cargando = false; pintar();
}

function filtrados() {
  const q = ex.q.trim().toLowerCase();
  let l = ex.archivos.filter(a => (!ex.tipo || a.tipo === ex.tipo) && (!ex.carpeta || a.carpeta === ex.carpeta || a.carpeta.startsWith(ex.carpeta + '/'))
    && (!ex.uso || estadoUso(a)[0] === ex.uso)
    && (!q || `${a.nombre} ${a.public_id} ${a.carpeta} ${a.formato}`.toLowerCase().includes(q)));
  const ord = { peso: (a, b) => b.bytes - a.bytes, reciente: (a, b) => String(b.creado).localeCompare(String(a.creado)), nombre: (a, b) => a.nombre.localeCompare(b.nombre) }[ex.orden];
  return l.sort(ord);
}

function vistaPrevia(a, grande) {
  if (a.miniatura) return `<img src="${escapeHtml(grande && a.tipo === 'image' && a.bytes < 3 * MB && a.formato !== 'pdf' ? a.url : a.miniatura)}" loading="lazy" alt="">`;
  return `<div class="arch-fmt">${escapeHtml((a.formato || TIPO_UNO[a.tipo] || '?').toUpperCase())}</div>`;
}

function etiquetaUso(u) {
  return `<div class="arch-uso ${u.auditoria ? 'aud' : ''}">
    <b>${escapeHtml(nombreModulo(u.esquema))}</b> · ${escapeHtml(u.tabla)}${u.etiqueta ? ` · «${escapeHtml(u.etiqueta)}»` : ''}
    <small>${escapeHtml(u.esquema)}.${escapeHtml(u.tabla)}.${escapeHtml(u.columna)}${u.id ? ` · registro ${escapeHtml(String(u.id).slice(0, 40))}` : ''}${u.auditoria ? ' · solo historial' : ''}</small></div>`;
}

function pintar() {
  const ov = document.getElementById('arch-overlay');
  if (!ov) return;
  const lista = filtrados();
  const carpetas = [...new Set(ex.archivos.map(a => a.carpeta))].sort();
  const cuenta = t => ex.archivos.filter(a => !t || a.tipo === t).length;
  const usos = [['', 'Todos'], ['uso', 'En uso'], ['libre', 'Sin uso en QUBIRA'], ['auditoria', 'Solo en auditoría'], ['otra', 'De otras apps'], ['ejemplo', 'Ejemplos de Cloudinary']];
  const selBytes = ex.archivos.filter(a => ex.sel.has(a.public_id)).reduce((s, a) => s + a.bytes, 0);
  const det = ex.detalle ? ex.archivos.find(a => a.public_id === ex.detalle) : null;
  const scroll = ov.querySelector('.arch-grid')?.scrollTop;

  ov.innerHTML = `<div class="arch-box" role="dialog" aria-modal="true" aria-label="Archivos de Cloudinary">
    <div class="arch-head">
      <div><h3>${icon('cloud')} Archivos de Cloudinary</h3>
        <p>${ex.archivos.length} archivos · ${tam(ex.archivos.reduce((s, a) => s + a.bytes, 0))}${ex.generado ? ` · usos calculados ${new Date(ex.generado).toLocaleTimeString('es-PE')}` : ''}</p></div>
      <div class="arch-head-der">
        <button class="btn btn-secondary btn-sm" data-a="recargar" ${ex.cargando ? 'disabled' : ''}>${icon('activity')} ${ex.cargando ? 'Analizando…' : 'Recalcular usos'}</button>
        <button class="close-btn" data-a="cerrar" title="Cerrar (Esc)">${icon('close')}</button>
      </div>
    </div>
    <div class="arch-filtros">
      <div class="arch-tabs">${[['', 'Todos'], ['image', 'Imágenes'], ['raw', 'Documentos'], ['video', 'Videos']].map(([t, n]) => `<button class="btn btn-sm ${ex.tipo === t ? 'btn-primary' : 'btn-secondary'}" data-tipo="${t}">${n} <span class="arch-n">${cuenta(t)}</span></button>`).join('')}</div>
      <div class="search-box">${icon('search')}<input type="text" id="arch-q" placeholder="Buscar por nombre, carpeta o formato…" value="${escapeHtml(ex.q)}"></div>
      <select id="arch-carpeta"><option value="">Todas las carpetas</option>${carpetas.map(c => `<option value="${escapeHtml(c)}" ${ex.carpeta === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
      <select id="arch-uso">${usos.map(([v, t]) => `<option value="${v}" ${ex.uso === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="arch-orden"><option value="peso" ${ex.orden === 'peso' ? 'selected' : ''}>Más pesados</option><option value="reciente" ${ex.orden === 'reciente' ? 'selected' : ''}>Más recientes</option><option value="nombre" ${ex.orden === 'nombre' ? 'selected' : ''}>Nombre</option></select>
    </div>
    <div class="arch-selbar ${ex.sel.size ? '' : 'oculta'}">
      <span><b>${ex.sel.size}</b> seleccionado${ex.sel.size === 1 ? '' : 's'} · ${tam(selBytes)}</span>
      <span style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" data-a="todos">Seleccionar los ${lista.length} visibles</button>
        <button class="btn btn-secondary btn-sm" data-a="ninguno">Quitar selección</button>
        <button class="btn btn-danger btn-sm" data-a="eliminar-sel">${icon('trash')} Eliminar definitivamente</button>
      </span>
    </div>
    <div class="arch-cuerpo">
      <div class="arch-grid">${ex.error ? `<div class="arch-vacio">⚠️ ${escapeHtml(ex.error)}</div>` : ex.cargando && !ex.archivos.length ? '<div class="arch-vacio">Leyendo Cloudinary y buscando dónde se usa cada archivo en la base de QUBIRA… (puede tardar unos segundos)</div>'
        : !lista.length ? '<div class="arch-vacio">Ningún archivo coincide con los filtros.</div>'
        : lista.map(a => { const [, txt, col] = estadoUso(a); return `<div class="arch-card ${ex.sel.has(a.public_id) ? 'sel' : ''} ${ex.detalle === a.public_id ? 'activo' : ''}" data-id="${escapeHtml(a.public_id)}">
          <label class="arch-check" title="Seleccionar"><input type="checkbox" data-sel="${escapeHtml(a.public_id)}" ${ex.sel.has(a.public_id) ? 'checked' : ''}></label>
          <div class="arch-thumb">${vistaPrevia(a)}${a.tipo === 'video' ? '<span class="arch-play">▶</span>' : ''}</div>
          <div class="arch-info"><b title="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</b><small>${escapeHtml(a.carpeta)}</small>
            <div class="arch-meta"><span>${tam(a.bytes)}</span><span>${escapeHtml((a.formato || '').toUpperCase())}</span></div>
            <span class="badge badge-${col}">${txt}</span></div></div>`; }).join('')}</div>
      ${det ? panelDetalle(det) : ''}
    </div>
  </div>`;
  if (scroll) ov.querySelector('.arch-grid').scrollTop = scroll;
  conectar(ov);
}

function panelDetalle(a) {
  const [, txt, col] = estadoUso(a);
  const reales = a.usos.filter(u => !u.auditoria), aud = a.usos.filter(u => u.auditoria);
  const o = origen(a);
  const explica = reales.length ? `Este archivo se muestra o se usa en ${reales.length} ${reales.length === 1 ? 'lugar' : 'lugares'} de QUBIRA. Si lo eliminas, ahí aparecerá roto.`
    : o === 'ejemplo' ? 'Es un archivo de ejemplo que Cloudinary crea al abrir la cuenta. QUBIRA no lo usa; se puede eliminar sin problema.'
    : o === 'otra' ? `No aparece en la base de QUBIRA, pero está en la carpeta «${a.carpeta}», que parece de otra aplicación que comparte esta cuenta de Cloudinary. Confirma que esa app ya no lo usa antes de eliminarlo.`
    : aud.length ? 'Solo aparece en el historial de auditoría: ninguna pantalla de QUBIRA lo muestra.'
    : 'No se encontró en ninguna tabla de QUBIRA. Puede ser un archivo que quedó huérfano (se reemplazó o se borró el registro).';
  return `<aside class="arch-det">
    <div class="arch-det-head"><b>Detalle del archivo</b><button class="close-btn" data-a="cerrar-det">${icon('close')}</button></div>
    <div class="arch-det-prev">${a.tipo === 'video' ? `<video src="${escapeHtml(a.url)}" controls preload="none" poster="${escapeHtml(a.miniatura || '')}"></video>` : vistaPrevia(a, true)}</div>
    <h4>${escapeHtml(a.nombre)}</h4>
    <span class="badge badge-${col}">${txt}</span>
    <p class="arch-explica">${escapeHtml(explica)}</p>
    <dl class="arch-dl">
      <dt>Tipo</dt><dd>${TIPO_UNO[a.tipo] || a.tipo} · ${escapeHtml((a.formato || '—').toUpperCase())}</dd>
      <dt>Tamaño</dt><dd>${tam(a.bytes)}</dd>
      ${a.ancho ? `<dt>Dimensiones</dt><dd>${a.ancho} × ${a.alto} px</dd>` : ''}
      ${a.duracion ? `<dt>Duración</dt><dd>${Math.round(a.duracion)} s</dd>` : ''}
      ${a.paginas ? `<dt>Páginas</dt><dd>${a.paginas}</dd>` : ''}
      <dt>Carpeta</dt><dd>${escapeHtml(a.carpeta)}</dd>
      <dt>Subido</dt><dd>${formatDateTime(a.creado)}</dd>
      <dt>ID</dt><dd class="arch-id">${escapeHtml(a.public_id)}</dd>
    </dl>
    <div class="arch-det-titulo">Dónde se usa en QUBIRA (${reales.length})</div>
    ${reales.length ? reales.map(etiquetaUso).join('') : '<div class="arch-vacio chico">No se usa en ninguna pantalla de QUBIRA.</div>'}
    ${aud.length ? `<div class="arch-det-titulo">En el historial (${aud.length})</div>${aud.map(etiquetaUso).join('')}` : ''}
    <div class="arch-det-acc">
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')} Abrir original</a>
      <button class="btn btn-secondary btn-sm" data-a="copiar">Copiar URL</button>
      <button class="btn btn-danger btn-sm" data-a="eliminar-uno">${icon('trash')} Eliminar definitivamente</button>
    </div>
  </aside>`;
}

let _qDeb;
function conectar(ov) {
  ov.querySelector('[data-a="cerrar"]')?.addEventListener('click', cerrar);
  ov.querySelector('[data-a="recargar"]')?.addEventListener('click', () => cargar(true));
  ov.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { ex.tipo = b.dataset.tipo; pintar(); }));
  const q = ov.querySelector('#arch-q');
  q?.addEventListener('input', () => { clearTimeout(_qDeb); _qDeb = setTimeout(() => { ex.q = q.value; pintar(); const n = document.getElementById('arch-q'); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 250); });
  ov.querySelector('#arch-carpeta')?.addEventListener('change', e => { ex.carpeta = e.target.value; pintar(); });
  ov.querySelector('#arch-uso')?.addEventListener('change', e => { ex.uso = e.target.value; pintar(); });
  ov.querySelector('#arch-orden')?.addEventListener('change', e => { ex.orden = e.target.value; pintar(); });
  ov.querySelectorAll('[data-sel]').forEach(c => c.addEventListener('change', e => {
    e.stopPropagation();
    if (c.checked) ex.sel.add(c.dataset.sel); else ex.sel.delete(c.dataset.sel);
    pintar();
  }));
  ov.querySelectorAll('.arch-check').forEach(l => l.addEventListener('click', e => e.stopPropagation()));
  ov.querySelectorAll('.arch-card').forEach(c => c.addEventListener('click', () => { ex.detalle = c.dataset.id; pintar(); }));
  ov.querySelector('[data-a="cerrar-det"]')?.addEventListener('click', () => { ex.detalle = null; pintar(); });
  ov.querySelector('[data-a="todos"]')?.addEventListener('click', () => { filtrados().forEach(a => ex.sel.add(a.public_id)); pintar(); });
  ov.querySelector('[data-a="ninguno"]')?.addEventListener('click', () => { ex.sel.clear(); pintar(); });
  ov.querySelector('[data-a="eliminar-sel"]')?.addEventListener('click', () => pedirEliminar(ex.archivos.filter(a => ex.sel.has(a.public_id))));
  ov.querySelector('[data-a="eliminar-uno"]')?.addEventListener('click', () => pedirEliminar(ex.archivos.filter(a => a.public_id === ex.detalle)));
  ov.querySelector('[data-a="copiar"]')?.addEventListener('click', async () => {
    const a = ex.archivos.find(x => x.public_id === ex.detalle);
    try { await navigator.clipboard.writeText(a.url); toast('URL copiada', 'success'); } catch { toast('No se pudo copiar', 'error'); }
  });
}

// Confirmación con código 2FA
function pedirEliminar(lista) {
  if (!lista.length) return;
  document.getElementById('arch-dlg')?.remove();
  const enUso = lista.filter(a => a.usos.some(u => !u.auditoria));
  const otras = lista.filter(a => !a.usos.some(u => !u.auditoria) && origen(a) === 'otra');
  const total = lista.reduce((s, a) => s + a.bytes, 0);
  const dlg = document.createElement('div');
  dlg.id = 'arch-dlg';
  dlg.className = 'arch-dlg-ov';
  dlg.innerHTML = `<div class="arch-dlg" role="dialog" aria-modal="true">
    <h3>${icon('trash')} Eliminar definitivamente</h3>
    <p>Se eliminarán de Cloudinary <b>${lista.length} ${lista.length === 1 ? 'archivo' : 'archivos'}</b> (${tam(total)}). <b>Esta acción no se puede deshacer</b>: el archivo y sus versiones derivadas se borran y dejan de estar disponibles en internet.</p>
    <div class="arch-dlg-lista">${lista.slice(0, 8).map(a => `<div>${escapeHtml(a.nombre)} <small>${tam(a.bytes)}</small></div>`).join('')}${lista.length > 8 ? `<div><small>… y ${lista.length - 8} más</small></div>` : ''}</div>
    ${enUso.length ? `<div class="arch-dlg-aviso">⚠️ ${enUso.length === 1 ? 'Este archivo está' : `${enUso.length} archivos están`} en uso en QUBIRA (${[...new Set(enUso.flatMap(a => a.usos.filter(u => !u.auditoria).map(u => nombreModulo(u.esquema))))].join(', ')}). Dejarán de verse ahí.
      <label><input type="checkbox" id="arch-forzar"> Entiendo y quiero eliminarlos igualmente</label></div>` : ''}
    ${otras.length ? `<div class="arch-dlg-aviso azul">ℹ️ ${otras.length} ${otras.length === 1 ? 'archivo parece' : 'archivos parecen'} de otra aplicación que comparte esta cuenta (${[...new Set(otras.map(a => a.carpeta.split('/')[0]))].join(', ')}). Confirma que ya no se usan allí.</div>` : ''}
    <label class="arch-dlg-cod">Código de verificación en dos pasos (2FA)
      <input type="text" id="arch-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label>
    <p class="arch-dlg-error" id="arch-dlg-error"></p>
    <div class="arch-dlg-acc"><button class="btn btn-secondary" data-a="cancelar">Cancelar</button><button class="btn btn-danger" data-a="confirmar" disabled>Eliminar definitivamente</button></div>
  </div>`;
  document.body.appendChild(dlg);
  const cod = dlg.querySelector('#arch-codigo');
  const ok = dlg.querySelector('[data-a="confirmar"]');
  const forzar = dlg.querySelector('#arch-forzar');
  const validar = () => { ok.disabled = !/^\d{6}$/.test(cod.value) || (forzar && !forzar.checked); };
  cod.addEventListener('input', () => { cod.value = cod.value.replace(/\D/g, '').slice(0, 6); validar(); });
  forzar?.addEventListener('change', validar);
  cod.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
  dlg.querySelector('[data-a="cancelar"]').addEventListener('click', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  setTimeout(() => cod.focus(), 50);
  ok.addEventListener('click', async () => {
    ok.disabled = true; ok.textContent = 'Eliminando…';
    const err = dlg.querySelector('#arch-dlg-error'); err.textContent = '';
    try {
      const r = await Store.deleteCloudinary({ archivos: lista.map(a => ({ public_id: a.public_id, tipo: a.tipo })), code: cod.value, forzar: !!forzar?.checked });
      const borrados = new Set(r.resultados.filter(x => x.ok).map(x => x.public_id));
      ex.archivos = ex.archivos.filter(a => !borrados.has(a.public_id));
      borrados.forEach(id => ex.sel.delete(id));
      if (borrados.has(ex.detalle)) ex.detalle = null;
      dlg.remove(); pintar();
      const fallidos = r.resultados.filter(x => !x.ok);
      toast(fallidos.length ? `Se eliminaron ${r.eliminados} de ${lista.length}. No se pudo: ${fallidos.map(x => x.public_id.split('/').pop()).join(', ')}` : `${r.eliminados} ${r.eliminados === 1 ? 'archivo eliminado' : 'archivos eliminados'} de Cloudinary`, fallidos.length ? 'error' : 'success');
      ex.alEliminar?.();
    } catch (e) {
      err.textContent = e.message === 'Hay archivos en uso' ? 'Hay archivos en uso: marca la casilla de confirmación.' : (e.message || 'No se pudo eliminar');
      ok.textContent = 'Eliminar definitivamente'; cod.value = ''; cod.focus(); validar();
    }
  });
}

function estilos() {
  if (document.getElementById('arch-estilos')) return;
  const s = document.createElement('style');
  s.id = 'arch-estilos';
  s.textContent = `
  .arch-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 18px; }
  .arch-box { background: #fff; border-radius: 14px; width: 100%; max-width: 1280px; height: 92vh; display: flex; flex-direction: column; box-shadow: var(--shadow-md); overflow: hidden; }
  .arch-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
  .arch-head h3 { margin: 0; font-size: 16px; display: flex; gap: 8px; align-items: center; }
  .arch-head p { margin: 2px 0 0; font-size: 12px; color: var(--text-muted); }
  .arch-head-der { display: flex; gap: 8px; align-items: center; }
  .arch-filtros { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--border); }
  .arch-filtros select { border: 1px solid var(--border); border-radius: 8px; padding: 7px 8px; font-size: 12.5px; background: #fff; max-width: 220px; }
  .arch-filtros .search-box { flex: 1; min-width: 200px; }
  .arch-tabs { display: flex; gap: 4px; }
  .arch-n { font-size: 10.5px; opacity: .75; margin-left: 2px; }
  .arch-selbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 20px; background: var(--danger-bg); color: var(--danger); font-size: 13px; }
  .arch-selbar.oculta { display: none; }
  .arch-cuerpo { flex: 1; display: flex; min-height: 0; }
  .arch-grid { flex: 1; overflow-y: auto; padding: 14px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); grid-auto-rows: max-content; gap: 12px; align-content: start; }
  .arch-card { position: relative; min-height: 220px; border: 1px solid var(--border); border-radius: 10px; background: #fff; cursor: pointer; overflow: hidden; transition: box-shadow .15s, border-color .15s; }
  .arch-card:hover { border-color: var(--primary); box-shadow: var(--shadow); }
  .arch-card.activo { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-light); }
  .arch-card.sel { border-color: var(--danger); background: #fff7f7; }
  .arch-check { position: absolute; top: 6px; left: 6px; z-index: 2; background: #fff; border-radius: 6px; padding: 2px 4px; box-shadow: var(--shadow); cursor: pointer; }
  .arch-thumb { position: relative; height: 120px; background: repeating-conic-gradient(#f1f5f9 0% 25%, #fff 0% 50%) 50% / 16px 16px; display: flex; align-items: center; justify-content: center; }
  .arch-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .arch-play { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: rgba(15,23,42,.65); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .arch-fmt { font-weight: 800; font-size: 15px; color: var(--primary); background: var(--primary-light); border-radius: 8px; padding: 10px 14px; }
  .arch-info { padding: 8px 10px 10px; }
  .arch-info b { display: block; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .arch-info small { display: block; font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .arch-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin: 4px 0 6px; }
  .badge-blue { background: var(--primary-light); color: var(--primary); }
  .arch-vacio { grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-size: 13px; padding: 40px 16px; }
  .arch-vacio.chico { padding: 10px; font-size: 12px; }
  .arch-det { width: 380px; flex: none; border-left: 1px solid var(--border); overflow-y: auto; padding: 14px 18px; background: #fafafa; }
  .arch-det-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; }
  .arch-det-prev { border-radius: 10px; overflow: hidden; background: repeating-conic-gradient(#f1f5f9 0% 25%, #fff 0% 50%) 50% / 16px 16px; min-height: 160px; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
  .arch-det-prev img, .arch-det-prev video { max-width: 100%; max-height: 260px; display: block; }
  .arch-det h4 { margin: 0 0 6px; font-size: 14px; word-break: break-all; }
  .arch-explica { font-size: 12.5px; color: var(--text); background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
  .arch-dl { display: grid; grid-template-columns: 92px 1fr; gap: 4px 8px; font-size: 12px; margin: 8px 0; }
  .arch-dl dt { color: var(--text-muted); } .arch-dl dd { margin: 0; font-weight: 600; }
  .arch-id { word-break: break-all; font-family: ui-monospace, monospace; font-weight: 500 !important; font-size: 11px; }
  .arch-det-titulo { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: var(--text-muted); margin: 12px 0 6px; }
  .arch-uso { background: #fff; border: 1px solid #bbf7d0; border-left: 3px solid var(--success); border-radius: 8px; padding: 6px 9px; font-size: 12px; margin-bottom: 5px; }
  .arch-uso.aud { border-color: var(--border); border-left-color: var(--gray); }
  .arch-uso small { display: block; color: var(--text-muted); font-size: 10.5px; word-break: break-all; }
  .arch-det-acc { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  .arch-dlg-ov { position: fixed; inset: 0; z-index: 1100; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .arch-dlg { background: #fff; border-radius: 12px; width: 100%; max-width: 480px; padding: 20px 22px; box-shadow: var(--shadow-md); }
  .arch-dlg h3 { margin: 0 0 8px; font-size: 16px; color: var(--danger); display: flex; gap: 8px; align-items: center; }
  .arch-dlg p { font-size: 13px; margin: 0 0 10px; }
  .arch-dlg-lista { max-height: 130px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; margin-bottom: 10px; }
  .arch-dlg-lista small { color: var(--text-muted); }
  .arch-dlg-aviso { background: var(--warning-bg); color: var(--warning); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; font-weight: 600; margin-bottom: 10px; }
  .arch-dlg-aviso.azul { background: var(--primary-light); color: var(--primary-dark); }
  .arch-dlg-aviso label { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-weight: 700; cursor: pointer; }
  .arch-dlg-cod { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--text); }
  .arch-dlg-cod input { font-size: 24px; letter-spacing: 10px; text-align: center; border: 1px solid var(--border); border-radius: 10px; padding: 10px; font-family: ui-monospace, monospace; }
  .arch-dlg-error { color: var(--danger); font-size: 12.5px; font-weight: 600; min-height: 16px; margin: 6px 0 0 !important; }
  .arch-dlg-acc { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  @media (max-width: 900px) { .arch-det { position: absolute; inset: 0; width: auto; z-index: 3; } .arch-cuerpo { position: relative; } }`;
  document.head.appendChild(s);
}
