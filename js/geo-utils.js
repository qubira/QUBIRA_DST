/**
 * Utilidades matemáticas y geoespaciales para Geocercas y Perímetros en QUBIRA DST.
 */

/**
 * Algoritmo Ray-Casting (Punto en Polígono).
 * Determina si unas coordenadas [lat, lng] caen dentro de un polígono cerrado.
 * @param {[number, number]} point - [lat, lng]
 * @param {Array<[number, number]>} polygon - Array de [lat, lng]
 * @returns {boolean}
 */
export function isPointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return true; // Si no hay perímetro definido, no se bloquea
  const [lat, lng] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const latI = polygon[i][0];
    const lngI = polygon[i][1];
    const latJ = polygon[j][0];
    const lngJ = polygon[j][1];

    const intersect = ((lngI > lng) !== (lngJ > lng)) &&
      (lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Fórmula de Haversine para calcular distancia ortodrómica en kilómetros.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distancia en kilómetros
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio medio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calcula la distancia aproximada de un punto hacia el segmento de recta más cercano del polígono.
 * @param {[number, number]} point - [lat, lng]
 * @param {Array<[number, number]>} polygon - Vértices [lat, lng]
 * @returns {number} Distancia mínima en kilómetros
 */
export function distanceToPolygon(point, polygon) {
  if (!polygon || polygon.length === 0) return 0;
  const [pLat, pLng] = point;

  let minDistance = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const [lat1, lng1] = polygon[i];
    const [lat2, lng2] = polygon[j];

    // Distancia simple al vértice
    const dVertex = haversineDistance(pLat, pLng, lat1, lng1);
    if (dVertex < minDistance) minDistance = dVertex;

    // Distancia perpendicular aproximada al segmento
    const segmentDist = distancePointToSegmentKm(pLat, pLng, lat1, lng1, lat2, lng2);
    if (segmentDist < minDistance) minDistance = segmentDist;
  }

  return minDistance === Infinity ? 0 : minDistance;
}

function distancePointToSegmentKm(pLat, pLng, lat1, lng1, lat2, lng2) {
  const l2 = (lat2 - lat1) * (lat2 - lat1) + (lng2 - lng1) * (lng2 - lng1);
  if (l2 === 0) return haversineDistance(pLat, pLng, lat1, lng1);

  // Proyección del punto sobre el segmento
  let t = ((pLat - lat1) * (lat2 - lat1) + (pLng - lng1) * (lng2 - lng1)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projLat = lat1 + t * (lat2 - lat1);
  const projLng = lng1 + t * (lng2 - lng1);

  return haversineDistance(pLat, pLng, projLat, projLng);
}

/**
 * Calcula el centroide de un polígono.
 * @param {Array<[number, number]>} polygon 
 * @returns {[number, number]}
 */
export function calculateCentroid(polygon) {
  if (!polygon || polygon.length === 0) return [-12.046374, -77.042793]; // Lima por defecto
  let sumLat = 0;
  let sumLng = 0;
  polygon.forEach(([lat, lng]) => {
    sumLat += lat;
    sumLng += lng;
  });
  return [sumLat / polygon.length, sumLng / polygon.length];
}

/**
 * Calcula el área aproximada en km² usando proyección esférica simple.
 * @param {Array<[number, number]>} polygon 
 * @returns {number}
 */
export function calculatePolygonAreaKm2(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  const R = 6371; // Radio de la Tierra en km
  let total = 0;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const [lat1, lng1] = polygon[i];
    const [lat2, lng2] = polygon[j];

    const radLat1 = lat1 * Math.PI / 180;
    const radLat2 = lat2 * Math.PI / 180;
    const radLngDiff = (lng2 - lng1) * Math.PI / 180;

    total += radLngDiff * (2 + Math.sin(radLat1) + Math.sin(radLat2));
  }

  return Math.abs(total * R * R / 2);
}
