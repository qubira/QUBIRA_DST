// Gráficos SVG minimalistas, sin librerías externas (consistente con
// el resto de Qubira: todo autocontenido, sin dependencias de CDN).

function fmtDayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* Gráfico de barras agrupadas de dos series (ej. logins exitosos vs
   fallidos por día). `data` es un array de {dia, [keyA], [keyB]}. */
export function groupedBarChart(data, { keyA, keyB, colorA, colorB, width = 560, height = 170 } = {}) {
  const pad = { top: 8, right: 8, bottom: 22, left: 26 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...data.map(d => Math.max(d[keyA] || 0, d[keyB] || 0)));
  const n = Math.max(1, data.length);
  const groupW = chartW / n;
  const barW = Math.max(2, groupW * 0.32);
  const gridLines = [0, 0.5, 1].map(f => {
    const y = pad.top + chartH * (1 - f);
    const val = Math.round(maxVal * f);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
            <text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${val}</text>`;
  }).join('');

  let bars = '';
  let labels = '';
  data.forEach((d, i) => {
    const x0 = pad.left + i * groupW + groupW * 0.14;
    const hA = ((d[keyA] || 0) / maxVal) * chartH;
    const hB = ((d[keyB] || 0) / maxVal) * chartH;
    bars += `<rect x="${x0}" y="${pad.top + chartH - hA}" width="${barW}" height="${hA}" fill="${colorA}" rx="1.5"><title>${d[keyA] || 0}</title></rect>`;
    bars += `<rect x="${x0 + barW + 2}" y="${pad.top + chartH - hB}" width="${barW}" height="${hB}" fill="${colorB}" rx="1.5"><title>${d[keyB] || 0}</title></rect>`;
    const showLabel = n <= 7 || i % Math.ceil(n / 7) === 0 || i === n - 1;
    if (showLabel) {
      labels += `<text x="${x0 + barW}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${fmtDayLabel(d.dia)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${gridLines}${bars}${labels}</svg>`;
}

/* Gráfico de barras de una sola serie (ej. accesos denegados por día). */
export function singleBarChart(data, { key, color, width = 560, height = 130 } = {}) {
  const pad = { top: 8, right: 8, bottom: 22, left: 26 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...data.map(d => d[key] || 0));
  const n = Math.max(1, data.length);
  const groupW = chartW / n;
  const barW = Math.max(3, groupW * 0.55);

  let bars = '';
  let labels = '';
  data.forEach((d, i) => {
    const x0 = pad.left + i * groupW + (groupW - barW) / 2;
    const h = ((d[key] || 0) / maxVal) * chartH;
    bars += `<rect x="${x0}" y="${pad.top + chartH - h}" width="${barW}" height="${h}" fill="${color}" rx="1.5"><title>${d[key] || 0}</title></rect>`;
    const showLabel = n <= 7 || i % Math.ceil(n / 7) === 0 || i === n - 1;
    if (showLabel) {
      labels += `<text x="${x0 + barW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${fmtDayLabel(d.dia)}</text>`;
    }
  });
  const zeroLine = `<line x1="${pad.left}" y1="${pad.top + chartH}" x2="${width - pad.right}" y2="${pad.top + chartH}" stroke="var(--border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${zeroLine}${bars}${labels}</svg>`;
}

/* Gráfico de dona simple (ej. sesiones activas por área). `data` es
   un array de {label, value}. Se arma con conic-gradient (CSS) en vez
   de un truco de stroke-dasharray sobre un <circle> — ese enfoque se
   veía como un octágono facetado en vez de un círculo liso; con
   conic-gradient el navegador dibuja el círculo de forma nativa. */
export function donutChart(data, { size = 150, colors = [], holeLabel = 'sesiones' } = {}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const holeSize = Math.round(size * 0.6);
  const holeInset = Math.round((size - holeSize) / 2);

  let background = 'var(--gray-bg)';
  if (total > 0) {
    let acc = 0;
    const stops = data.map((d, i) => {
      const start = (acc / total) * 360;
      acc += d.value;
      const end = (acc / total) * 360;
      return `${colors[i % colors.length]} ${start}deg ${end}deg`;
    });
    background = `conic-gradient(${stops.join(', ')})`;
  }

  return `
    <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${background};flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <div style="position:absolute;inset:${holeInset}px;border-radius:50%;background:var(--card-bg);display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span style="font-size:${Math.round(size * 0.16)}px;font-weight:800;color:var(--text);line-height:1">${total}</span>
        <span style="font-size:${Math.round(size * 0.075)}px;color:var(--text-muted);margin-top:3px;text-transform:uppercase;letter-spacing:.04em">${holeLabel}</span>
      </div>
    </div>`;
}

export const DONUT_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280'];
