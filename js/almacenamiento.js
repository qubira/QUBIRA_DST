// Control de almacenamiento: base de datos (Neon) y archivos (Cloudinary)
// en tiempo real, con alertas por umbral, proyecciones e historial.
import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast } from './ui.js';
import { abrirExplorador, MODULOS, nombreModulo } from './almacenamiento-archivos.js';

// Explicaciones de cada dato (ícono «i»)
const INFO = {
  neonUsado: 'Espacio que ocupa hoy la base de datos de QUBIRA en Neon (datos + índices), frente al límite de tu plan. Si llega al 100 %, Neon deja de aceptar escrituras.',
  creditos: 'Cloudinary cobra en «créditos». El plan Free trae 25 por mes. Se gastan guardando archivos, sirviéndolos (ancho de banda) y generando versiones (transformaciones).',
  archivosCloud: 'Peso total de las imágenes, documentos y videos guardados en Cloudinary, y cuántos archivos hay (los «originales» son los subidos; el resto son versiones derivadas como miniaturas).',
  conexiones: 'Conexiones abiertas ahora mismo entre la API y la base. Pocas conexiones y baja latencia = la base responde bien.',
  cache: 'Porcentaje de lecturas que Neon resolvió desde memoria sin ir al disco. Sobre 95 % es excelente; si baja mucho, las consultas se vuelven lentas.',
  conActivas: 'Conexiones que están ejecutando una consulta en este instante, sobre el total de conexiones abiertas.',
  latencia: 'Tiempo que tarda la base en responder una consulta simple desde la API. Incluye la distancia al servidor de Neon.',
  transacciones: 'Operaciones confirmadas (guardar, editar, consultar) que la base registró desde su último reinicio.',
  enVivo: 'Cómo cambia el tamaño de la base mientras tienes abierta esta pantalla (una lectura cada intervalo elegido).',
  esquemas: 'La base se divide en «esquemas»: uno por módulo de QUBIRA. Aquí ves cuánto ocupa cada módulo y cuántas filas (registros) guarda.',
  almacenamiento: 'Espacio que ocupan todos tus archivos guardados en Cloudinary. Cada 1 GB guardado consume 1 crédito al mes.',
  anchoBanda: 'Datos que Cloudinary envió este mes a quienes vieron o descargaron archivos (logos, documentos, videos). Cada 1 GB enviado consume 1 crédito.',
  transformaciones: 'Versiones que Cloudinary generó a partir de tus archivos (miniaturas, recortes, cambios de formato). Cada 1 000 consumen 1 crédito.',
  image: 'Fotos, logos e íconos (PNG, JPG, WEBP, SVG) y PDF subidos como imagen. Haz clic para verlos.',
  raw: 'Documentos que no son imagen (Word, Excel, ZIP, etc.). Haz clic para verlos.',
  video: 'Videos y audios (MP4, MP3…). Son los que más pesan. Haz clic para verlos.',
  objetos: 'Total de objetos en Cloudinary contando los originales y sus versiones derivadas (miniaturas, recortes). Haz clic para ver los archivos.',
  solicitudes: 'Cantidad de veces que se pidió algún archivo a Cloudinary este mes (cada vez que una pantalla muestra un logo o documento).',
  rateLimit: 'Consultas a la API de administración de Cloudinary que quedan en esta hora (este panel las usa para leer las cifras). Se reinicia cada hora.',
  maxImagen: 'Tamaño máximo que permite tu plan para subir una sola imagen. Archivos más grandes serán rechazados.',
  historial: 'Cada 15 minutos (mientras alguien abre este panel) se guarda una foto del tamaño de Neon y Cloudinary. El gráfico muestra el último valor de cada día para ver la tendencia.',
  tablas: 'Las tablas que más ocupan en la base. «Datos» es la información; «Índices», las estructuras que aceleran las búsquedas.',
  filas: 'Registros que contiene la tabla. «Eliminadas» son filas borradas o reemplazadas que aún ocupan espacio hasta la próxima limpieza automática.',
  datos: 'Espacio que ocupa la información en sí.',
  indices: 'Espacio de los índices: copias ordenadas que hacen rápidas las búsquedas. Ocupan espacio a cambio de velocidad.',
  total: 'Datos + índices + almacenamiento auxiliar (TOAST) de la tabla.',
  limpieza: 'Última vez que Neon limpió las filas eliminadas de la tabla (VACUUM). Neon lo hace automáticamente.',
  carpetas: 'Cuánto ocupa cada carpeta de Cloudinary. Haz clic en una carpeta para ver y administrar sus archivos. Las carpetas que no empiezan con «qubira/» suelen ser de otras apps que comparten la cuenta.',
  pesados: 'Los archivos que más espacio ocupan. Haz clic para ver qué son, dónde se usan y eliminarlos si ya no sirven.',
  recientes: 'Los últimos archivos subidos a Cloudinary.',
};
const info = (clave, texto) => `<button type="button" class="alm-i" data-info="${escapeHtml(texto || INFO[clave] || '')}" aria-label="Qué es esto">i</button>`;
const infoModulo = e => info(null, MODULOS[e] ? `${MODULOS[e][0]}: ${MODULOS[e][1]}` : `Esquema «${e}» de la base de datos.`);

// Burbuja de ayuda de los íconos «i»
document.addEventListener('click', e => {
  const b = e.target.closest?.('.alm-i');
  document.getElementById('alm-pop')?.remove();
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const pop = document.createElement('div');
  pop.id = 'alm-pop'; pop.className = 'alm-pop'; pop.textContent = b.dataset.info;
  document.body.appendChild(pop);
  const r = b.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(window.innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 10) top = r.top - h - 8;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}, true);

const INTERVALOS = [[10, '10 s'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [0, 'En pausa']];
const st = {
  intervalo: 15, timer: null, neon: null, cloud: null, hist: null, errorNeon: null, errorCloud: null,
  muestras: [], ultimaNeon: null, ultimaCloud: null, cargandoDetalle: false,
};

const MB = 1048576;
function tam(b) {
  if (b === null || b === undefined || isNaN(b)) return '—';
  b = Number(b);
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= MB) return (b / MB).toFixed(b >= 100 * MB ? 0 : 1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}
const num = n => Number(n || 0).toLocaleString('es-PE');
const pctColor = p => p >= 90 ? 'red' : p >= 70 ? 'amber' : 'green';
const hora = d => d ? new Date(d).toLocaleTimeString('es-PE') : '—';

export function renderAlmacenamiento() {
  const c = document.getElementById('view-almacenamiento');
  estilos();
  c.innerHTML = `
    <div class="toolbar alm-toolbar">
      <div class="toolbar__filters">
        <span class="alm-vivo" id="alm-vivo">Conectando…</span>
        <label class="alm-intervalo">Actualizar cada
          <select id="alm-intervalo">${INTERVALOS.map(([v, t]) => `<option value="${v}" ${v === st.intervalo ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
      </div>
      <div class="toolbar__filters">
        <button class="btn btn-secondary btn-sm" id="alm-refrescar">${icon('activity')} Actualizar todo ahora</button>
      </div>
    </div>
    <div id="alm-alertas"></div>
    <div class="kpi-grid" id="alm-kpis"></div>
    <div class="alm-grid">
      <div class="card"><div class="card__header"><h3>${icon('database')} Neon · base de datos</h3><span class="alm-sub" id="alm-neon-sub"></span></div><div class="card__body" id="alm-neon"></div></div>
      <div class="card"><div class="card__header"><h3>${icon('cloud')} Cloudinary · archivos</h3><span class="alm-sub" id="alm-cloud-sub"></span></div><div class="card__body" id="alm-cloud"></div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card__header"><h3>${icon('bar-chart-2')} Crecimiento del almacenamiento ${info('historial')}</h3><span class="alm-sub">Una foto cada 15 min · último valor de cada día</span></div><div class="card__body" id="alm-hist"></div></div>
    <div class="alm-grid">
      <div class="card"><div class="card__header"><h3>Tablas más pesadas (Neon) ${info('tablas')}</h3><span class="alm-sub">Top 25</span></div><div class="card__body alm-sin-pad" id="alm-tablas"></div></div>
      <div class="card"><div class="card__header"><h3>Carpetas de Cloudinary ${info('carpetas')}</h3><button class="btn btn-secondary btn-sm" id="alm-detalle-btn">Recalcular</button></div><div class="card__body alm-sin-pad" id="alm-carpetas"></div></div>
    </div>
    <div class="alm-grid">
      <div class="card"><div class="card__header"><h3>Archivos más pesados ${info('pesados')}</h3></div><div class="card__body alm-sin-pad" id="alm-pesados"></div></div>
      <div class="card"><div class="card__header"><h3>Subidos recientemente ${info('recientes')}</h3></div><div class="card__body alm-sin-pad" id="alm-recientes"></div></div>
    </div>`;
  document.getElementById('alm-intervalo').addEventListener('change', e => { st.intervalo = Number(e.target.value); programar(); pintarVivo(); });
  document.getElementById('alm-refrescar').addEventListener('click', () => cargarTodo(true));
  document.getElementById('alm-detalle-btn').addEventListener('click', () => cargarCloud(true, true));
  const tras = () => cargarCloud(true, true);
  if (!c.dataset.almClic) c.dataset.almClic = '1', c.addEventListener('click', e => {
    if (e.target.closest('.alm-i') || e.target.closest('a')) return;
    const t = e.target.closest('[data-explorar]');
    if (t) return abrirExplorador({ tipo: t.dataset.explorar, alEliminar: tras });
    const f = e.target.closest('[data-carpeta]');
    if (f) return abrirExplorador({ carpeta: f.dataset.carpeta, alEliminar: tras });
    const a = e.target.closest('[data-archivo]');
    if (a) return abrirExplorador({ publicId: a.dataset.archivo, alEliminar: tras });
  });
  pintarTodo();
  cargarTodo(false);
  programar();
}

function vistaActiva() { return document.getElementById('view-almacenamiento')?.classList.contains('active'); }

function programar() {
  clearInterval(st.timer);
  if (!st.intervalo) return;
  let ticks = 0;
  st.timer = setInterval(() => {
    if (!vistaActiva()) { clearInterval(st.timer); st.timer = null; return; }
    ticks++;
    cargarNeon();
    // Cloudinary cambia poco (sus cifras se actualizan a diario): cada minuto basta
    if ((ticks * st.intervalo) % 60 < st.intervalo) cargarCloud(false, false);
  }, st.intervalo * 1000);
}

async function cargarTodo(forzar) {
  await Promise.all([cargarNeon(), cargarCloud(forzar, true), cargarHistorial()]);
  if (forzar) toast('Almacenamiento actualizado', 'success');
}

async function cargarNeon() {
  try {
    st.neon = await Store.getStorageNeon();
    st.errorNeon = null; st.ultimaNeon = new Date();
    st.muestras.push({ t: Date.now(), bytes: st.neon.bytes });
    if (st.muestras.length > 120) st.muestras.shift();
  } catch (e) { if (e.message !== 'SESSION_EXPIRED') st.errorNeon = e.message; }
  if (vistaActiva()) { pintarKpis(); pintarAlertas(); pintarNeon(); pintarTablas(); pintarVivo(); }
}

async function cargarCloud(forzar, detalle) {
  if (detalle) { st.cargandoDetalle = true; pintarCarpetas(); }
  try {
    const r = await Store.getStorageCloudinary({ detalle: detalle || !st.cloud?.detalle ? 1 : undefined, refrescar: forzar ? 1 : undefined });
    st.cloud = { ...r, detalle: r.detalle || st.cloud?.detalle, detalle_error: r.detalle_error };
    st.errorCloud = null; st.ultimaCloud = new Date();
  } catch (e) { if (e.message !== 'SESSION_EXPIRED') st.errorCloud = e.message; }
  st.cargandoDetalle = false;
  if (vistaActiva()) { pintarKpis(); pintarAlertas(); pintarCloud(); pintarCarpetas(); pintarArchivos(); pintarVivo(); }
}

async function cargarHistorial() {
  try { st.hist = await Store.getStorageHistory(60); } catch (e) { st.hist = { error: e.message }; }
  if (vistaActiva()) pintarHistorial();
}

function pintarTodo() { pintarVivo(); pintarKpis(); pintarAlertas(); pintarNeon(); pintarCloud(); pintarHistorial(); pintarTablas(); pintarCarpetas(); pintarArchivos(); }

function pintarVivo() {
  const el = document.getElementById('alm-vivo');
  if (!el) return;
  const err = st.errorNeon || st.errorCloud;
  el.className = 'alm-vivo ' + (err ? 'error' : st.intervalo ? '' : 'pausa');
  el.textContent = err ? 'Error de conexión' : !st.ultimaNeon ? 'Conectando…' : `${st.intervalo ? 'En vivo' : 'En pausa'} · ${hora(st.ultimaNeon)}`;
  el.title = err || '';
}

// ── Proyecciones ──
function ritmoNeon() {
  const dias = st.hist?.dias || [];
  if (dias.length < 2) return null;
  const a = dias[0], b = dias[dias.length - 1];
  const d = (new Date(b.taken_at) - new Date(a.taken_at)) / 86400000;
  if (d < 0.5) return null;
  return (Number(b.neon_bytes) - Number(a.neon_bytes)) / d; // bytes por día
}
function proyeccionCreditos() {
  const u = st.cloud?.creditos;
  if (!u) return null;
  const h = new Date();
  const dia = h.getDate(), diasMes = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
  return { usado: u.usage, limite: u.limit, fin: u.usage / Math.max(dia, 1) * diasMes };
}

function pintarKpis() {
  const el = document.getElementById('alm-kpis');
  if (!el) return;
  const n = st.neon, c = st.cloud;
  const p = proyeccionCreditos();
  const kpi = (label, valor, hint, color, ic, inf) => `<div class="kpi-card"><div><div class="kpi-card__label">${label} ${info(inf)}</div><div class="kpi-card__value">${valor}</div><div class="kpi-card__hint">${hint}</div></div><div class="kpi-card__icon ${color}">${icon(ic)}</div></div>`;
  el.innerHTML = [
    kpi('Neon usado', n ? tam(n.bytes) : '—', n ? `${n.porcentaje}% de ${tam(n.limite_bytes)} del plan` : (st.errorNeon ? 'Sin conexión' : 'Cargando…'), n ? pctColor(n.porcentaje) : 'gray', 'database', 'neonUsado'),
    kpi('Créditos Cloudinary', c?.creditos ? `${Number(c.creditos.usage).toFixed(2)} / ${c.creditos.limit}` : '—', c?.creditos ? `${Number(c.creditos.used_percent).toFixed(1)}% del mes${p ? ` · proyección fin de mes ${p.fin.toFixed(1)}` : ''}` : (st.errorCloud ? 'Sin conexión' : 'Cargando…'), c?.creditos ? pctColor(c.creditos.used_percent) : 'gray', 'cloud', 'creditos'),
    kpi('Archivos en Cloudinary', c ? tam(c.almacenamiento?.usage) : '—', c ? `${num(c.objetos)} objetos · ${num(c.recursos)} originales` : '—', 'blue', 'grid', 'archivosCloud'),
    kpi('Conexiones a Neon', n ? `${n.conexiones.total}` : '—', n ? `${n.conexiones.activas} activas · máx. ${n.conexiones.max} · ${n.latencia_ms} ms` : '—', 'gray', 'activity', 'conexiones'),
  ].join('');
}

function pintarAlertas() {
  const el = document.getElementById('alm-alertas');
  if (!el) return;
  const a = [];
  const n = st.neon, c = st.cloud;
  if (st.errorNeon) a.push(['red', `No se pudo leer Neon: ${st.errorNeon}`]);
  if (st.errorCloud) a.push(['red', `No se pudo leer Cloudinary: ${st.errorCloud}`]);
  if (n && n.porcentaje >= 90) a.push(['red', `Neon está al ${n.porcentaje}% del plan: libera espacio o amplía el plan.`]);
  else if (n && n.porcentaje >= 70) a.push(['amber', `Neon está al ${n.porcentaje}% del plan.`]);
  const r = ritmoNeon();
  if (n && r && r > 0) {
    const dias = (n.limite_bytes - n.bytes) / r;
    if (dias < 120) a.push([dias < 30 ? 'red' : 'amber', `Al ritmo actual (${tam(r)}/día) Neon se llenaría en ~${Math.round(dias)} días.`]);
  }
  if (c?.creditos && c.creditos.used_percent >= 90) a.push(['red', `Cloudinary usó el ${Number(c.creditos.used_percent).toFixed(1)}% de los créditos del mes.`]);
  else if (c?.creditos && c.creditos.used_percent >= 70) a.push(['amber', `Cloudinary usó el ${Number(c.creditos.used_percent).toFixed(1)}% de los créditos del mes.`]);
  const p = proyeccionCreditos();
  if (p && p.fin > p.limite) a.push(['amber', `A este ritmo, Cloudinary terminaría el mes con ${p.fin.toFixed(1)} de ${p.limite} créditos.`]);
  const muertas = (n?.tablas || []).filter(t => Number(t.filas_muertas) > 1000 && Number(t.filas_muertas) > Number(t.filas) * 0.2);
  if (muertas.length) a.push(['amber', `Tablas con muchas filas eliminadas pendientes de limpieza (VACUUM): ${muertas.map(t => `${t.esquema}.${t.tabla}`).join(', ')}.`]);
  const samples = (c?.detalle?.carpetas || []).filter(x => /^samples(\/|$)/.test(x.carpeta)).reduce((s, x) => s + x.bytes, 0);
  if (samples > 5 * MB) a.push(['info', `Las imágenes y videos de ejemplo de Cloudinary («samples») ocupan ${tam(samples)}; puedes eliminarlos desde la consola de Cloudinary para liberar espacio.`]);
  el.innerHTML = a.map(([t, m]) => `<div class="alm-alerta ${t}">${icon(t === 'info' ? 'bell' : 'alert-triangle')}<span>${escapeHtml(m)}</span></div>`).join('');
}

function barra(p, color) {
  return `<div class="alm-barra"><div class="alm-barra__fill ${color || pctColor(p)}" style="width:${Math.min(100, Math.max(0, p))}%"></div></div>`;
}

// Mini gráfico de las lecturas en vivo de esta sesión
function sparkline(muestras, w = 260, h = 40) {
  if (muestras.length < 2) return '<div class="alm-mini">Reuniendo lecturas en vivo…</div>';
  const v = muestras.map(m => m.bytes);
  const min = Math.min(...v), max = Math.max(...v), rango = Math.max(1, max - min);
  const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 4 - (x - min) / rango * (h - 8)).toFixed(1)}`).join(' ');
  const delta = v[v.length - 1] - v[0];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2"/></svg>
    <div class="alm-mini">${v.length} lecturas · ${delta === 0 ? 'sin cambios' : (delta > 0 ? '+' : '−') + tam(Math.abs(delta))} en esta sesión</div>`;
}

function pintarNeon() {
  const el = document.getElementById('alm-neon');
  if (!el) return;
  const n = st.neon;
  const sub = document.getElementById('alm-neon-sub');
  if (!n) { el.innerHTML = `<div class="alm-vacio">${st.errorNeon ? escapeHtml(st.errorNeon) : 'Consultando la base…'}</div>`; return; }
  if (sub) sub.textContent = `${n.db} · PostgreSQL ${n.version.split(' ')[0]}`;
  const maxE = Math.max(...n.esquemas.map(e => Number(e.bytes)), 1);
  el.innerHTML = `
    <div class="alm-uso"><div><strong>${tam(n.bytes)}</strong> de ${tam(n.limite_bytes)}</div><span class="badge badge-${pctColor(n.porcentaje) === 'red' ? 'red' : pctColor(n.porcentaje) === 'amber' ? 'amber' : 'green'}">${n.porcentaje}%</span></div>
    ${barra(n.porcentaje)}
    <div class="alm-stats">
      <div><b>${n.cache_hit ?? '—'}%</b><span>lecturas desde caché ${info('cache')}</span></div>
      <div><b>${n.conexiones.activas}/${n.conexiones.total}</b><span>conexiones activas ${info('conActivas')}</span></div>
      <div><b>${n.latencia_ms} ms</b><span>latencia ${info('latencia')}</span></div>
      <div><b>${num(n.commits)}</b><span>transacciones ${info('transacciones')}</span></div>
    </div>
    <div class="alm-titulo">En vivo ${info('enVivo')}</div>
    ${sparkline(st.muestras)}
    <div class="alm-titulo">Por esquema (módulo) ${info('esquemas')}</div>
    ${n.esquemas.map(e => `<div class="alm-fila">
      <span class="alm-fila__nombre">${escapeHtml(e.esquema)} ${infoModulo(e.esquema)}<small>${escapeHtml(nombreModulo(e.esquema))} · ${num(e.tablas)} tablas · ${num(e.filas)} filas</small></span>
      <div class="alm-fila__barra">${barra(Number(e.bytes) / maxE * 100, 'blue')}</div>
      <span class="alm-fila__val">${tam(e.bytes)}</span></div>`).join('')}
    <p class="alm-nota">Tamaño de los datos e índices de la base. Neon factura además el historial de cambios (WAL), que puede sumar algo más en su consola.</p>`;
}

function pintarCloud() {
  const el = document.getElementById('alm-cloud');
  if (!el) return;
  const c = st.cloud;
  const sub = document.getElementById('alm-cloud-sub');
  if (!c) { el.innerHTML = `<div class="alm-vacio">${st.errorCloud ? escapeHtml(st.errorCloud) : 'Consultando Cloudinary…'}</div>`; return; }
  if (sub) sub.textContent = `Plan ${c.plan || '—'} · cifras de Cloudinary al ${c.actualizado_por_cloudinary || '—'}`;
  const cr = c.creditos || { usage: 0, limit: 0, used_percent: 0 };
  const det = [
    ['Almacenamiento', c.almacenamiento, tam(c.almacenamiento?.usage), 'almacenamiento'],
    ['Ancho de banda (mes)', c.ancho_banda, tam(c.ancho_banda?.usage), 'anchoBanda'],
    ['Transformaciones', c.transformaciones, num(c.transformaciones?.usage), 'transformaciones'],
  ];
  const tipos = c.detalle?.por_tipo || [];
  const nombreTipo = { image: 'Imágenes', raw: 'Documentos', video: 'Videos' };
  el.innerHTML = `
    <div class="alm-uso"><div><strong>${Number(cr.usage).toFixed(2)}</strong> de ${cr.limit} créditos del mes</div><span class="badge badge-${pctColor(cr.used_percent) === 'red' ? 'red' : pctColor(cr.used_percent) === 'amber' ? 'amber' : 'green'}">${Number(cr.used_percent).toFixed(1)}%</span></div>
    ${barra(cr.used_percent)}
    <div class="alm-titulo">En qué se gastan los créditos ${info('creditos')}</div>
    ${det.map(([t, d, v, k]) => `<div class="alm-fila">
      <span class="alm-fila__nombre">${t} ${info(k)}<small>${v}</small></span>
      <div class="alm-fila__barra">${barra(cr.limit ? (d?.credits_usage || 0) / cr.limit * 100 : 0, 'blue')}</div>
      <span class="alm-fila__val">${Number(d?.credits_usage || 0).toFixed(2)} cr</span></div>`).join('')}
    ${tipos.length ? `<div class="alm-titulo">Por tipo de archivo · clic para ver los archivos</div><div class="alm-stats">${tipos.map(t => `<div class="alm-clic" data-explorar="${t.tipo}" title="Ver ${nombreTipo[t.tipo] || t.tipo}"><b>${tam(t.bytes)}</b><span>${nombreTipo[t.tipo] || t.tipo} · ${num(t.archivos)} ${info(t.tipo)}</span></div>`).join('')}</div>` : ''}
    <div class="alm-stats">
      <div class="alm-clic" data-explorar="" title="Ver todos los archivos"><b>${num(c.objetos)}</b><span>objetos (con derivados) ${info('objetos')}</span></div>
      <div><b>${num(c.solicitudes)}</b><span>solicitudes del mes ${info('solicitudes')}</span></div>
      <div><b>${c.rate_limit?.restante ?? '—'}/${c.rate_limit?.permitido ?? '—'}</b><span>consultas API disponibles (hora) ${info('rateLimit')}</span></div>
      <div><b>${tam(c.limites?.image_max_size_bytes)}</b><span>máx. por imagen ${info('maxImagen')}</span></div>
    </div>
    <button type="button" class="btn btn-primary btn-sm alm-explorar" data-explorar="">${icon('cloud')} Explorar y administrar archivos</button>
    <p class="alm-nota">1 crédito = 1 GB guardado, 1 GB de ancho de banda o 1 000 transformaciones. Los créditos se reinician cada mes; Cloudinary actualiza estas cifras una vez al día.</p>`;
}

function pintarTablas() {
  const el = document.getElementById('alm-tablas');
  if (!el) return;
  const t = st.neon?.tablas;
  if (!t) { el.innerHTML = '<div class="alm-vacio">Cargando…</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tabla</th><th>Filas ${info('filas')}</th><th>Datos ${info('datos')}</th><th>Índices ${info('indices')}</th><th>Total ${info('total')}</th><th>Limpieza ${info('limpieza')}</th></tr></thead><tbody>
    ${t.map(x => `<tr><td><b>${escapeHtml(x.tabla)}</b><div class="alm-sub">${escapeHtml(x.esquema)} · ${escapeHtml(nombreModulo(x.esquema))} ${infoModulo(x.esquema)}</div></td><td>${num(x.filas)}${Number(x.filas_muertas) ? `<div class="alm-sub">${num(x.filas_muertas)} eliminadas</div>` : ''}</td>
      <td>${tam(x.datos)}</td><td>${tam(x.indices)}</td><td><b>${tam(x.bytes)}</b></td><td class="alm-sub">${x.ultimo_vacuum ? formatDateTime(x.ultimo_vacuum) : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function pintarCarpetas() {
  const el = document.getElementById('alm-carpetas');
  if (!el) return;
  const d = st.cloud?.detalle;
  if (st.cargandoDetalle && !d) { el.innerHTML = '<div class="alm-vacio">Recorriendo los archivos de Cloudinary…</div>'; return; }
  if (!d) { el.innerHTML = `<div class="alm-vacio">${escapeHtml(st.cloud?.detalle_error || 'Sin detalle todavía.')}</div>`; return; }
  const max = Math.max(...d.carpetas.map(x => x.bytes), 1);
  el.innerHTML = `<div class="alm-pad"><div class="alm-sub" style="margin-bottom:8px">${num(d.total_archivos)} archivos · ${tam(d.total_bytes)} · calculado ${hora(d.generado)}${st.cargandoDetalle ? ' · recalculando…' : ''}</div>
    ${d.carpetas.map(x => `<div class="alm-fila alm-clic" data-carpeta="${escapeHtml(x.carpeta)}" title="Ver los archivos de esta carpeta">
      <span class="alm-fila__nombre">${escapeHtml(x.carpeta)}<small>${num(x.archivos)} archivos${x.imagenes ? ` · ${x.imagenes} img` : ''}${x.documentos ? ` · ${x.documentos} doc` : ''}${x.videos ? ` · ${x.videos} video` : ''}</small></span>
      <div class="alm-fila__barra">${barra(x.bytes / max * 100, /^samples/.test(x.carpeta) ? 'amber' : 'blue')}</div>
      <span class="alm-fila__val">${tam(x.bytes)}</span></div>`).join('')}</div>`;
}

function filaArchivo(x) {
  const nombre = String(x.public_id).split('/').pop();
  const carpeta = String(x.public_id).split('/').slice(0, -1).join('/') || '(raíz)';
  return `<tr class="alm-clic" data-archivo="${escapeHtml(x.public_id)}" title="Ver detalle y dónde se usa"><td><b>${escapeHtml(nombre)}</b><div class="alm-sub">${escapeHtml(carpeta)}</div></td>
    <td><span class="badge badge-gray">${escapeHtml(x.tipo === 'image' ? 'imagen' : x.tipo === 'raw' ? 'documento' : x.tipo)}${x.formato ? ' · ' + escapeHtml(x.formato) : ''}</span></td>
    <td><b>${tam(x.bytes)}</b></td><td class="alm-sub">${formatDateTime(x.creado)}</td>
    <td>${x.url ? `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">${icon('external-link')}</a>` : ''}</td></tr>`;
}
function pintarArchivos() {
  const d = st.cloud?.detalle;
  const tabla = filas => `<div class="table-wrap"><table><thead><tr><th>Archivo</th><th>Tipo</th><th>Tamaño</th><th>Subido</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
  const a = document.getElementById('alm-pesados'), b = document.getElementById('alm-recientes');
  if (a) a.innerHTML = d ? tabla(d.mas_pesados.map(filaArchivo).join('')) : '<div class="alm-vacio">Cargando…</div>';
  if (b) b.innerHTML = d ? tabla(d.recientes.map(filaArchivo).join('')) : '<div class="alm-vacio">Cargando…</div>';
}

// Gráfico de líneas del historial (Neon y Cloudinary en MB)
function pintarHistorial() {
  const el = document.getElementById('alm-hist');
  if (!el) return;
  const h = st.hist;
  if (!h) { el.innerHTML = '<div class="alm-vacio">Cargando historial…</div>'; return; }
  if (h.error) { el.innerHTML = `<div class="alm-vacio">${escapeHtml(h.error)}</div>`; return; }
  const dias = h.dias || [];
  if (dias.length < 2) {
    el.innerHTML = `<div class="alm-vacio">El historial se empieza a registrar desde hoy (una foto cada 15 min mientras alguien abre este panel). En unos días verás aquí la tendencia de crecimiento.${dias.length ? `<br><small>Primera foto: ${formatDateTime(dias[0].taken_at)} · Neon ${tam(dias[0].neon_bytes)} · Cloudinary ${tam(dias[0].cloud_storage_bytes)}</small>` : ''}</div>`;
    return;
  }
  const W = 900, H = 200, pad = { l: 46, r: 46, t: 12, b: 26 };
  const series = [
    { k: 'neon_bytes', color: '#4f46e5', nombre: 'Neon', eje: 'izq' },
    { k: 'cloud_storage_bytes', color: '#0ea5e9', nombre: 'Cloudinary', eje: 'der' },
  ];
  const xs = dias.map(d => new Date(d.taken_at).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => pad.l + (t - x0) / Math.max(1, x1 - x0) * (W - pad.l - pad.r);
  let svg = '';
  series.forEach(s => {
    const v = dias.map(d => Number(d[s.k])).filter(x => !isNaN(x) && x > 0);
    if (v.length < 2) return;
    const min = Math.min(...v) * 0.98, max = Math.max(...v) * 1.02;
    const Y = x => pad.t + (1 - (x - min) / Math.max(1, max - min)) * (H - pad.t - pad.b);
    const pts = dias.filter(d => Number(d[s.k]) > 0).map(d => `${X(new Date(d.taken_at).getTime()).toFixed(1)},${Y(Number(d[s.k])).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
    const xEje = s.eje === 'izq' ? pad.l - 6 : W - pad.r + 6;
    [min, max].forEach(val => { svg += `<text x="${xEje}" y="${Y(val) + 3}" text-anchor="${s.eje === 'izq' ? 'end' : 'start'}" font-size="10" fill="${s.color}">${tam(val)}</text>`; });
  });
  [0, Math.floor((dias.length - 1) / 2), dias.length - 1].forEach(i => {
    const d = new Date(dias[i].taken_at);
    svg += `<text x="${X(d.getTime())}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</text>`;
  });
  const r = ritmoNeon();
  const ultimo = dias[dias.length - 1], primero = dias[0];
  el.innerHTML = `<div class="alm-leyenda">${series.map(s => `<span><i style="background:${s.color}"></i>${s.nombre}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${svg}</svg>
    <div class="alm-stats">
      <div><b>${r === null ? '—' : (r >= 0 ? '+' : '−') + tam(Math.abs(r))}</b><span>Neon por día (promedio)</span></div>
      <div><b>${tam(Number(ultimo.neon_bytes) - Number(primero.neon_bytes))}</b><span>Neon desde ${formatDateTime(primero.taken_at).split(' ')[0]}</span></div>
      <div><b>${tam(Number(ultimo.cloud_storage_bytes || 0) - Number(primero.cloud_storage_bytes || 0))}</b><span>Cloudinary en el mismo periodo</span></div>
      <div><b>${dias.length}</b><span>días con registro</span></div>
    </div>`;
}

function estilos() {
  if (document.getElementById('alm-estilos')) return;
  const s = document.createElement('style');
  s.id = 'alm-estilos';
  s.textContent = `
  .alm-toolbar { justify-content: space-between; }
  .alm-vivo { font-size: 12px; font-weight: 700; color: var(--success); background: var(--success-bg); border-radius: 999px; padding: 5px 12px; }
  .alm-vivo::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--success); margin-right: 6px; vertical-align: middle; animation: almPulso 1.6s infinite; }
  .alm-vivo.pausa { color: var(--gray); background: var(--gray-bg); } .alm-vivo.pausa::before { background: var(--gray); animation: none; }
  .alm-vivo.error { color: var(--danger); background: var(--danger-bg); } .alm-vivo.error::before { background: var(--danger); }
  @keyframes almPulso { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
  .alm-intervalo { font-size: 12.5px; color: var(--text-muted); display: flex; gap: 6px; align-items: center; }
  .alm-intervalo select { border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; font-size: 12.5px; background: #fff; }
  .alm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 1100px) { .alm-grid { grid-template-columns: 1fr; } }
  .card__header h3 { display: flex; align-items: center; gap: 8px; }
  .alm-sub { font-size: 11.5px; color: var(--text-muted); font-weight: 500; }
  .alm-sin-pad { padding: 0 !important; } .alm-pad { padding: 14px 18px; }
  .alm-alerta { display: flex; gap: 10px; align-items: center; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; font-size: 13px; font-weight: 600; }
  .alm-alerta.red { background: var(--danger-bg); color: var(--danger); } .alm-alerta.amber { background: var(--warning-bg); color: var(--warning); }
  .alm-alerta.info { background: var(--primary-light); color: var(--primary-dark); }
  .alm-uso { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
  .alm-uso strong { font-size: 22px; color: var(--text); margin-right: 4px; }
  .alm-barra { height: 10px; background: var(--gray-bg); border-radius: 999px; overflow: hidden; }
  .alm-barra__fill { height: 100%; border-radius: 999px; transition: width .6s ease; }
  .alm-barra__fill.green { background: var(--success); } .alm-barra__fill.amber { background: #f59e0b; } .alm-barra__fill.red { background: var(--danger); } .alm-barra__fill.blue { background: var(--primary); }
  .alm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0 4px; }
  .alm-stats > div { background: var(--gray-bg); border-radius: 8px; padding: 8px 10px; }
  .alm-stats b { display: block; font-size: 15px; } .alm-stats span { font-size: 11px; color: var(--text-muted); }
  @media (max-width: 700px) { .alm-stats { grid-template-columns: repeat(2, 1fr); } }
  .alm-titulo { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: var(--text-muted); margin: 16px 0 8px; }
  .alm-fila { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 13px; }
  .alm-fila__nombre { width: 200px; flex: none; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .alm-fila__nombre small { display: block; font-weight: 500; font-size: 11px; color: var(--text-muted); }
  .alm-fila__barra { flex: 1; } .alm-fila__barra .alm-barra { height: 7px; }
  .alm-fila__val { width: 78px; text-align: right; font-weight: 700; flex: none; }
  .alm-mini { font-size: 11px; color: var(--text-muted); }
  .alm-nota { font-size: 11.5px; color: var(--text-muted); margin: 12px 0 0; }
  .alm-vacio { text-align: center; color: var(--text-muted); font-size: 13px; padding: 26px 16px; }
  #alm-tablas td:not(:first-child), #alm-pesados td:not(:first-child), #alm-recientes td:not(:first-child) { white-space: nowrap; }
  .alm-i { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; border: 1px solid #c7d2fe; background: var(--primary-light); color: var(--primary); font: italic 700 10px Georgia, serif; cursor: help; padding: 0; margin-left: 3px; vertical-align: middle; text-transform: none; letter-spacing: 0; }
  .alm-i:hover { background: var(--primary); color: #fff; }
  .alm-pop { position: fixed; z-index: 2000; max-width: 300px; background: #111827; color: #f9fafb; font-size: 12.5px; line-height: 1.45; font-weight: 500; padding: 9px 12px; border-radius: 9px; box-shadow: var(--shadow-md); text-transform: none; letter-spacing: 0; }
  .alm-clic { cursor: pointer; transition: background .15s, box-shadow .15s; }
  .alm-stats > .alm-clic:hover { background: var(--primary-light); box-shadow: inset 0 0 0 1px #c7d2fe; }
  .alm-fila.alm-clic:hover, tr.alm-clic:hover td { background: var(--gray-bg); }
  .alm-explorar { margin-top: 12px; width: 100%; justify-content: center; }
  .alm-leyenda { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .alm-leyenda i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }`;
  document.head.appendChild(s);
}
