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
   un array de {label, value}. */
export function donutChart(data, { size = 150, colors = [] } = {}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 8, strokeW = size * 0.22;
  if (total === 0) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>
    </svg>`;
  }
  let angle = -90;
  const circumference = 2 * Math.PI * r;
  let arcs = '';
  data.forEach((d, i) => {
    const frac = d.value / total;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const color = colors[i % colors.length];
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}"
      stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-((angle + 90) / 360) * circumference}"
      transform="rotate(-90 ${cx} ${cy})"><title>${d.label}: ${d.value}</title></circle>`;
    angle += frac * 360;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text)">${total}</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="9" fill="var(--text-muted)">sesiones</text>
  </svg>`;
}

export const DONUT_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280'];
