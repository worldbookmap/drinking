import fs from 'fs/promises';

const provinces = [
  { key: 'yunnan', label: '운남', code: '530000' },
  { key: 'guizhou', label: '귀주', code: '520000' },
  { key: 'sichuan', label: '사천', code: '510000' },
  { key: 'guangxi', label: '광서', code: '450000' },
  { key: 'guangdong', label: '광동', code: '440000' },
  { key: 'fujian', label: '복건', code: '350000' },
  { key: 'zhejiang', label: '절강', code: '330000' },
  { key: 'anhui', label: '안휘', code: '340000' },
  { key: 'jiangsu', label: '강소', code: '320000' },
  { key: 'jiangxi', label: '강서', code: '360000' },
  { key: 'hunan', label: '호남', code: '430000' },
  { key: 'hubei', label: '호북', code: '420000' },
  { key: 'shanxi', label: '섬서', code: '610000' },
  { key: 'henan', label: '하남', code: '410000' }
];

function sqSegDist(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i += 1) {
    const sqDistance = sqSegDist(points[i], points[first], points[last]);
    if (sqDistance > maxSqDist) {
      index = i;
      maxSqDist = sqDistance;
    }
  }

  if (maxSqDist > sqTolerance) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplify(points, tolerance = 0.03) {
  if (points.length <= 6) return points;
  const sqTolerance = tolerance * tolerance;
  const last = points.length - 1;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);
  return simplified;
}

function extractRings(feature) {
  const rings = [];
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') {
    if (coordinates[0]) rings.push(coordinates[0]);
    return rings;
  }
  if (type === 'MultiPolygon') {
    for (const polygon of coordinates) {
      if (polygon[0]) rings.push(polygon[0]);
    }
  }
  return rings;
}

function pathFromRing(ring, projector) {
  const simplified = simplify(ring, 0.03);
  if (simplified.length < 3) return '';
  const pts = simplified.map(projector);
  const [first, ...rest] = pts;
  return `M${first[0].toFixed(2)} ${first[1].toFixed(2)}${rest.map((p) => ` L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')} Z`;
}

async function fetchProvince(code) {
  const urls = [
    `https://geo.datav.aliyun.com/areas_v3/bound/${code}.json`,
    `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`
  ];

  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const provinceGeo = [];
for (const p of provinces) {
  const geo = await fetchProvince(p.code);
  const feature = geo.features?.[0];
  if (!feature) throw new Error(`No feature for ${p.label}`);
  const rings = extractRings(feature).map((r) => r.map((pt) => [pt[0], pt[1]]));
  provinceGeo.push({ ...p, center: feature.properties?.center || feature.properties?.centroid || null, rings });
}

let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;

for (const p of provinceGeo) {
  for (const ring of p.rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

const width = 360;
const height = 280;
const pad = 20;
const scaleX = (width - pad * 2) / (maxX - minX);
const scaleY = (height - pad * 2) / (maxY - minY);
const scale = Math.min(scaleX, scaleY);
const projW = (maxX - minX) * scale;
const projH = (maxY - minY) * scale;
const offsetX = (width - projW) / 2;
const offsetY = (height - projH) / 2;

function project([lon, lat]) {
  const x = offsetX + (lon - minX) * scale;
  const y = offsetY + (maxY - lat) * scale;
  return [x, y];
}

const out = provinceGeo.map((p) => {
  const paths = p.rings.map((ring) => pathFromRing(ring, project)).filter(Boolean);
  const centerSource = Array.isArray(p.center) ? p.center : p.rings[0][Math.floor(p.rings[0].length / 2)];
  const [cx, cy] = project(centerSource);

  return {
    key: p.key,
    label: p.label,
    textX: Number(cx.toFixed(2)),
    textY: Number(cy.toFixed(2)),
    paths
  };
});

await fs.writeFile('assets/tea-province-map-data.json', JSON.stringify(out, null, 2), 'utf8');
console.log('generated', out.length);
