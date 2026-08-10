import fs from 'fs/promises';

const WORLD_COUNTRIES_GEOJSON = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const GEOBOUNDARIES_API_BASE = 'https://www.geoboundaries.org/api/current/gbOpen';
const COUNTRY_CONFIGS = [
  {
    key: 'france',
    label: '프랑스',
    countryName: 'France',
    gbIso: 'FRA',
    gbAdm: 'ADM2',
    ringFilter: 'franceMainland',
    zoom: 0.88,
    focusKeys: ['bordeaux', 'bourgogne', 'champagne', 'loire', 'rhone', 'alsace', 'provence', 'languedoc', 'jura', 'savoie', 'roussillon'],
    regions: [
      { key: 'bordeaux', label: '보르도', units: ['gironde'] },
      { key: 'bourgogne', label: '부르고뉴', units: ["cote-d'or", 'cote d or'] },
      { key: 'champagne', label: '샹파뉴', units: ['marne'] },
      { key: 'loire', label: '루아르', units: ['loire-atlantique', 'loire atlantique'] },
      { key: 'rhone', label: '론', units: ['drome'] },
      { key: 'alsace', label: '알자스', units: ['bas-rhin', 'bas rhin'] },
      { key: 'provence', label: '프로방스', units: ['var'] },
      { key: 'languedoc', label: '랑그독', units: ['herault'] },
      { key: 'jura', label: '쥐라', units: ['jura'] },
      { key: 'savoie', label: '사부아', units: ['savoie'] },
      { key: 'roussillon', label: '루시용', units: ['pyrenees-orientales', 'pyrenees orientales'] }
    ]
  },
  {
    key: 'australia',
    label: '호주',
    countryName: 'Australia',
    gbIso: 'AUS',
    gbAdm: 'ADM1',
    zoom: 4.9,
    focusKeys: ['barossa'],
    regions: [
      { key: 'barossa', label: '바로사', units: ['south australia'] },
      { key: 'margaret', label: '마가렛', units: ['western australia'] },
      { key: 'hunter', label: '헌터', units: ['new south wales'] },
      { key: 'yarra', label: '야라', units: ['victoria'] },
      { key: 'tasmania', label: '태즈메이니아', units: ['tasmania'] },
      { key: 'granitebelt', label: '그라니트벨트', units: ['queensland'] }
    ]
  },
  {
    key: 'usa',
    label: '미국',
    countryName: 'United States of America',
    gbIso: 'USA',
    gbAdm: 'ADM2',
    admLevels: ['ADM1', 'ADM2'],
    ringFilter: 'westernUS',
    zoom: 0.9,
    crop: true,
    translateBiasY: -18,
    focusKeys: ['washington', 'oregon', 'columbia', 'napa', 'sonoma', 'centralcoast'],
    regions: [
      { key: 'washington', label: '워싱턴주', sourceAdm: 'ADM1', units: ['washington'] },
      { key: 'oregon', label: '오레곤', sourceAdm: 'ADM1', units: ['oregon'] },
      { key: 'columbia', label: '콜럼비아 밸리', units: ['walla walla'] },
      { key: 'napa', label: '나파벨리', units: ['napa'] },
      { key: 'sonoma', label: '소노마', units: ['sonoma'] },
      { key: 'centralcoast', label: '센트럴 코스트', units: ['san luis obispo', 'santa barbara', 'monterey'] }
    ]
  }
];

function getRingBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

function isMainlandFranceRing(ring) {
  const { minX, minY, maxX, maxY } = getRingBounds(ring);
  return minX > -10 && maxX < 15 && minY > 40 && maxY < 52;
}

function isWesternUSRing(ring) {
  const { minY, maxX, maxY } = getRingBounds(ring);
  return maxX <= -100 && minY >= 30 && maxY <= 50;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

function simplify(points, tolerance = 0.045) {
  if (points.length <= 8) return points;
  const sqTolerance = tolerance * tolerance;
  const last = points.length - 1;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);
  return simplified;
}

function extractRings(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    return coordinates?.[0] ? [coordinates[0]] : [];
  }
  if (type === 'MultiPolygon') {
    const rings = [];
    for (const polygon of coordinates || []) {
      if (polygon?.[0]) rings.push(polygon[0]);
    }
    return rings;
  }
  return [];
}

function filterRings(rings, filterKey) {
  if (!filterKey) return rings;
  if (filterKey === 'franceMainland') {
    const mainlandRings = rings.filter(isMainlandFranceRing);
    if (!mainlandRings.length) return rings;
    return [
      mainlandRings.reduce((largestRing, ring) => {
        const largestBounds = getRingBounds(largestRing);
        const ringBounds = getRingBounds(ring);
        const largestArea = (largestBounds.maxX - largestBounds.minX) * (largestBounds.maxY - largestBounds.minY);
        const ringArea = (ringBounds.maxX - ringBounds.minX) * (ringBounds.maxY - ringBounds.minY);
        return ringArea > largestArea ? ring : largestRing;
      })
    ];
  }
  if (filterKey === 'westernUS') {
    return rings.filter(isWesternUSRing);
  }
  return rings;
}

function pathFromRing(ring, projector) {
  const simplified = simplify(ring, 0.045);
  if (simplified.length < 3) return '';
  const projected = simplified.map(projector);
  const [first, ...rest] = projected;
  return `M${first[0].toFixed(2)} ${first[1].toFixed(2)}${rest.map((p) => ` L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')} Z`;
}

function computeCentroid(rings) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const ring of rings) {
    for (const [x, y] of ring) {
      sumX += x;
      sumY += y;
      count += 1;
    }
  }

  if (!count) return [0, 0];
  return [sumX / count, sumY / count];
}

function getFeatureName(feature) {
  const props = feature?.properties || {};
  const candidates = [
    props.shapeName,
    props.name,
    props.NAME_2,
    props.NAME_1,
    props.ADM2_NAME,
    props.ADM1_NAME,
    props.admin,
    props.name_en
  ];

  for (const candidate of candidates) {
    if (String(candidate || '').trim()) {
      return String(candidate).trim();
    }
  }

  return '';
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} ${response.status}`);
  }
  return response.json();
}

async function resolveGeoBoundariesUrl(iso, adm) {
  const metadataUrl = `${GEOBOUNDARIES_API_BASE}/${iso}/${adm}/`;
  const metadata = await fetchJson(metadataUrl);
  const candidate = metadata?.simplifiedGeometryGeoJSON || metadata?.gjDownloadURL;
  if (!candidate) {
    throw new Error(`No downloadable GeoJSON URL in ${metadataUrl}`);
  }
  return candidate;
}

function createProjector(allRings, focusRings = [], zoom = 1, width = 320, height = 240, pad = 10, crop = false, translateBiasY = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ring of allRings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const scaleX = (width - pad * 2) / (maxX - minX);
  const scaleY = (height - pad * 2) / (maxY - minY);
  const fitScale = Math.min(scaleX, scaleY);
  const scale = crop ? fitScale * zoom : Math.min(fitScale * zoom, fitScale);
  const projW = (maxX - minX) * scale;
  const projH = (maxY - minY) * scale;
  const offsetX = (width - projW) / 2;
  const offsetY = (height - projH) / 2;

  const projectedMinX = offsetX;
  const projectedMaxX = offsetX + projW;
  const projectedMinY = offsetY;
  const projectedMaxY = offsetY + projH;

  const focusSource = focusRings.length ? focusRings : allRings;
  const focusPoint = computeCentroid(focusSource);
  const [focusProjectX, focusProjectY] = [
    offsetX + (focusPoint[0] - minX) * scale,
    offsetY + (maxY - focusPoint[1]) * scale
  ];
  const targetX = width * 0.5;
  const targetY = height * 0.5;
  const desiredTranslateX = targetX - focusProjectX;
  const desiredTranslateY = targetY - focusProjectY;
  const minTranslateX = pad - projectedMinX;
  const maxTranslateX = width - pad - projectedMaxX;
  const minTranslateY = pad - projectedMinY;
  const maxTranslateY = height - pad - projectedMaxY;
  const translateX = crop ? desiredTranslateX : Math.min(Math.max(desiredTranslateX, minTranslateX), maxTranslateX);
  const translateY = crop ? desiredTranslateY + translateBiasY : Math.min(Math.max(desiredTranslateY, minTranslateY), maxTranslateY);

  return {
    project: ([lon, lat]) => {
      const x = offsetX + (lon - minX) * scale;
      const y = offsetY + (maxY - lat) * scale;
      return [x + translateX, y + translateY];
    },
    viewBox: `0 0 ${width} ${height}`
  };
}

function matchFeatures(adminFeatures, units) {
  const normalizedUnits = units.map((unit) => normalizeText(unit));
  const matched = [];

  for (const feature of adminFeatures) {
    const name = normalizeText(getFeatureName(feature));
    if (!name) continue;

    if (normalizedUnits.some((unit) => name === unit || name.includes(unit) || unit.includes(name))) {
      matched.push(feature);
    }
  }

  return matched;
}

const world = await fetchJson(WORLD_COUNTRIES_GEOJSON);
const countryFeatures = Array.isArray(world?.features) ? world.features : [];

const output = {};

for (const countryConfig of COUNTRY_CONFIGS) {
  const countryFeature = countryFeatures.find((feature) => {
    const props = feature?.properties || {};
    return normalizeText(props.name) === normalizeText(countryConfig.countryName);
  });

  if (!countryFeature) {
    throw new Error(`Country feature not found: ${countryConfig.countryName}`);
  }

  const adminLevels = Array.isArray(countryConfig.admLevels) && countryConfig.admLevels.length ? countryConfig.admLevels : [countryConfig.gbAdm];
  const adminFeaturesByLevel = {};
  for (const admLevel of adminLevels) {
    const adminUrl = await resolveGeoBoundariesUrl(countryConfig.gbIso, admLevel);
    const adminGeo = await fetchJson(adminUrl);
    adminFeaturesByLevel[admLevel] = Array.isArray(adminGeo?.features) ? adminGeo.features : [];
  }

  const countryRings = filterRings(
    extractRings(countryFeature.geometry).map((ring) => ring.map((pt) => [pt[0], pt[1]])),
    countryConfig.ringFilter
  );
  const regionDefs = [];

  for (const region of countryConfig.regions) {
    const regionAdm = region.sourceAdm || countryConfig.gbAdm;
    const features = matchFeatures(adminFeaturesByLevel[regionAdm] || [], region.units || []);
    if (!features.length) {
      console.warn(`[wine-map] region not found: ${countryConfig.label} / ${region.label}`);
      continue;
    }

    const rings = [];
    for (const feature of features) {
      const featureRings = filterRings(extractRings(feature.geometry), countryConfig.ringFilter);
      for (const ring of featureRings) {
        rings.push(ring.map((pt) => [pt[0], pt[1]]));
      }
    }

    if (!rings.length) {
      console.warn(`[wine-map] empty geometry: ${countryConfig.label} / ${region.label}`);
      continue;
    }

    regionDefs.push({
      key: region.key,
      label: region.label,
      rings
    });
  }

  const allRings = [...countryRings];
  for (const region of regionDefs) {
    allRings.push(...region.rings);
  }

  const focusRegions = new Set((countryConfig.focusKeys || []).map((value) => String(value).trim()));
  const focusRings = regionDefs
    .filter((region) => focusRegions.has(region.key))
    .flatMap((region) => region.rings);

  const { project, viewBox } = createProjector(allRings, focusRings, countryConfig.zoom || 1, 320, 240, 10, Boolean(countryConfig.crop), countryConfig.translateBiasY || 0);
  const outlinePath = countryRings.map((ring) => pathFromRing(ring, project)).filter(Boolean).join(' ');

  const regions = regionDefs.map((region) => {
    const path = region.rings.map((ring) => pathFromRing(ring, project)).filter(Boolean).join(' ');
    const center = computeCentroid(region.rings);
    const [textX, textY] = project(center);
    return {
      key: region.key,
      label: region.label,
      path,
      textX: Number(textX.toFixed(2)),
      textY: Number(textY.toFixed(2))
    };
  });

  output[countryConfig.key] = {
    viewBox,
    outlinePath,
    regions
  };

  console.log(`[wine-map] ${countryConfig.label}: ${regions.length} regions`);
}

await fs.writeFile('assets/wine-region-map-data.json', JSON.stringify(output, null, 2), 'utf8');
await fs.writeFile('assets/wine-region-map-data.js', `window.WINE_REGION_MAP_DATA = ${JSON.stringify(output)};\n`, 'utf8');
console.log('generated wine region map data');
