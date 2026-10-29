// Control de almacenamiento: base de datos (Neon) y archivos (Cloudinary)
// en tiempo real, con alertas por umbral, proyecciones e historial.
import { Store } from './storage.js';
import { icon, escapeHtml, formatDateTime } from './utils.js';
import { toast } from './ui.js';

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
    <div class="card" style="margin-bottom:16px"><div class="card__header"><h3>${icon('bar-chart-2')} Crecimiento del almacenamiento</h3><span class="alm-sub">Una foto cada 15 min · último valor de cada día</span></div><div class="card__body" id="alm-hist"></div></div>
    <div class="alm-grid">
      <div class="card"><div class="card__header"><h3>Tablas más pesadas (Neon)</h3><span class="alm-sub">Top 25</span></div><div class="card__body alm-sin-pad" id="alm-tablas"></div></div>
      <div class="card"><div class="card__header"><h3>Carpetas de Cloudinary</h3><button class="btn btn-secondary btn-sm" id="alm-detalle-btn">Recalcular</button></div><div class="card__body alm-sin-pad" id="alm-carpetas"></div></div>
    </div>
    <div class="alm-grid">
      <div class="card"><div class="card__header"><h3>Archivos más pesados</h3></div><div class="card__body alm-sin-pad" id="alm-pesados"></div></div>
      <div class="card"><div class="card__header"><h3>Subidos recientemente</h3></div><div class="card__body alm-sin-pad" id="alm-recientes"></div></div>
    </div>`;
  document.getElementById('alm-intervalo').addEventListener('change', e => { st.intervalo = Number(e.target.value); programar(); pintarVivo(); });
  document.getElementById('alm-refrescar').addEventListener('click', () => cargarTodo(true));
  document.getElementById('alm-detalle-btn').addEventListener('click', () => cargarCloud(true, true));
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
  const kpi = (label, valor, hint, color, ic) => `<div class="kpi-card"><div><div class="kpi-card__label">${label}</div><div class="kpi-card__value">${valor}</div><div class="kpi-card__hint">${hint}</div></div><div class="kpi-card__icon ${color}">${icon(ic)}</div></div>`;
  el.innerHTML = [
    kpi('Neon usado', n ? tam(n.bytes) : '—', n ? `${n.porcentaje}% de ${tam(n.limite_bytes)} del plan` : (st.errorNeon ? 'Sin conexión' : 'Cargando…'), n ? pctColor(n.porcentaje) : 'gray', 'database'),
    kpi('Créditos Cloudinary', c?.creditos ? `${Number(c.creditos.usage).toFixed(2)} / ${c.creditos.limit}` : '—', c?.creditos ? `${Number(c.creditos.used_percent).toFixed(1)}% del mes${p ? ` · proyección fin de mes ${p.fin.toFixed(1)}` : ''}` : (st.errorCloud ? 'Sin conexión' : 'Cargando…'), c?.creditos ? pctColor(c.creditos.used_percent) : 'gray', 'cloud'),
    kpi('Archivos en Cloudinary', c ? tam(c.almacenamiento?.usage) : '—', c ? `${num(c.objetos)} objetos · ${num(c.recursos)} originales` : '—', 'blue', 'grid'),
    kpi('Conexiones a Neon', n ? `${n.conexiones.total}` : '—', n ? `${n.conexiones.activas} activas · máx. ${n.conexiones.max} · ${n.latencia_ms} ms` : '—', 'gray', 'activity'),
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
      <div><b>${n.cache_hit ?? '—'}%</b><span>lecturas desde caché</span></div>
      <div><b>${n.conexiones.activas}/${n.conexiones.total}</b><span>conexiones activas</span></div>
      <div><b>${n.latencia_ms} ms</b><span>latencia</span></div>
      <div><b>${num(n.commits)}</b><span>transacciones</span></div>
    </div>
    <div class="alm-titulo">En vivo</div>
    ${sparkline(st.muestras)}
    <div class="alm-titulo">Por esquema (módulo)</div>
    ${n.esquemas.map(e => `<div class="alm-fila">
      <span class="alm-fila__nombre">${escapeHtml(e.esquema)}<small>${num(e.tablas)} tablas · ${num(e.filas)} filas</small></span>
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
    ['Almacenamiento', c.almacenamiento, tam(c.almacenamiento?.usage)],
    ['Ancho de banda (mes)', c.ancho_banda, tam(c.ancho_banda?.usage)],
    ['Transformaciones', c.transformaciones, num(c.transformaciones?.usage)],
  ];
  const tipos = c.detalle?.por_tipo || [];
  const nombreTipo = { image: 'Imágenes', raw: 'Documentos', video: 'Videos' };
  el.innerHTML = `
    <div class="alm-uso"><div><strong>${Number(cr.usage).toFixed(2)}</strong> de ${cr.limit} créditos del mes</div><span class="badge badge-${pctColor(cr.used_percent) === 'red' ? 'red' : pctColor(cr.used_percent) === 'amber' ? 'amber' : 'green'}">${Number(cr.used_percent).toFixed(1)}%</span></div>
    ${barra(cr.used_percent)}
    <div class="alm-titulo">En qué se gastan los créditos</div>
    ${det.map(([t, d, v]) => `<div class="alm-fila">
      <span class="alm-fila__nombre">${t}<small>${v}</small></span>
      <div class="alm-fila__barra">${barra(cr.limit ? (d?.credits_usage || 0) / cr.limit * 100 : 0, 'blue')}</div>
      <span class="alm-fila__val">${Number(d?.credits_usage || 0).toFixed(2)} cr</span></div>`).join('')}
    ${tipos.length ? `<div class="alm-titulo">Por tipo de archivo</div><div class="alm-stats">${tipos.map(t => `<div><b>${tam(t.bytes)}</b><span>${nombreTipo[t.tipo] || t.tipo} · ${num(t.archivos)}</span></div>`).join('')}</div>` : ''}
    <div class="alm-stats">
      <div><b>${num(c.objetos)}</b><span>objetos (con derivados)</span></div>
      <div><b>${num(c.solicitudes)}</b><span>solicitudes del mes</span></div>
      <div><b>${c.rate_limit?.restante ?? '—'}/${c.rate_limit?.permitido ?? '—'}</b><span>consultas API disponibles (hora)</span></div>
      <div><b>${tam(c.limites?.image_max_size_bytes)}</b><span>máx. por imagen</span></div>
    </div>
    <p class="alm-nota">1 crédito = 1 GB guardado, 1 GB de ancho de banda o 1 000 transformaciones. Los créditos se reinician cada mes; Cloudinary actualiza estas cifras una vez al día.</p>`;
}

function pintarTablas() {
  const el = document.getElementById('alm-tablas');
  if (!el) return;
  const t = st.neon?.tablas;
  if (!t) { el.innerHTML = '<div class="alm-vacio">Cargando…</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tabla</th><th>Filas</th><th>Datos</th><th>Índices</th><th>Total</th><th>Limpieza</th></tr></thead><tbody>
    ${t.map(x => `<tr><td><b>${escapeHtml(x.tabla)}</b><div class="alm-sub">${escapeHtml(x.esquema)}</div></td><td>${num(x.filas)}${Number(x.filas_muertas) ? `<div class="alm-sub">${num(x.filas_muertas)} eliminadas</div>` : ''}</td>
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
    ${d.carpetas.map(x => `<div class="alm-fila">
      <span class="alm-fila__nombre">${escapeHtml(x.carpeta)}<small>${num(x.archivos)} archivos${x.imagenes ? ` · ${x.imagenes} img` : ''}${x.documentos ? ` · ${x.documentos} doc` : ''}${x.videos ? ` · ${x.videos} video` : ''}</small></span>
      <div class="alm-fila__barra">${barra(x.bytes / max * 100, /^samples/.test(x.carpeta) ? 'amber' : 'blue')}</div>
      <span class="alm-fila__val">${tam(x.bytes)}</span></div>`).join('')}</div>`;
}

function filaArchivo(x) {
  const nombre = String(x.public_id).split('/').pop();
  const carpeta = String(x.public_id).split('/').slice(0, -1).join('/') || '(raíz)';
  return `<tr><td><b>${escapeHtml(nombre)}</b><div class="alm-sub">${escapeHtml(carpeta)}</div></td>
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
  .alm-leyenda { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .alm-leyenda i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }`;
  document.head.appendChild(s);
}
