/**
 * Pipeline Crossing Sketch — data model (no DOM).
 * Measurements, sizes, depths, stations, owners, and types are NEVER inferred.
 * Unknown is allowed and preferred when the inspector does not know.
 *
 * FUTURE hooks (not built): GIS overlay, DXF, cloud sync, signatures,
 * multi-alignment stationing, auto GPS (use store.getGps from the UI).
 */

import { uid } from '../../store.js';

export const FORMAT = 'uig-crossing-v1';

export const UTILITY_TYPES = [
  'Gas',
  'Water',
  'Sewer',
  'Storm Drain',
  'Electric',
  'Fiber',
  'Communication',
  'Oil',
  'Pipeline',
  'Drain',
  'Unknown',
  'Other',
];

export const CROSSING_TYPES = [
  'Overhead',
  'Underground',
  'Encased',
  'Uncased',
  'Bored / HDD',
  'Open cut',
  'Aerial',
  'Road crossing',
  'Water crossing',
  'Other',
];

export const UTILITY_STATUS = ['Active', 'Abandoned', 'Unknown'];

export const MEASURE_TYPES = [
  { id: 'verticalClearance', label: 'Vertical clearance' },
  { id: 'horizontalClearance', label: 'Horizontal clearance' },
  { id: 'depthBelowGrade', label: 'Depth below grade' },
  { id: 'offsetFromCenterline', label: 'Offset from pipeline centerline' },
  { id: 'distanceFromStation', label: 'Distance from station/reference' },
  { id: 'pipeOd', label: 'Pipe OD' },
  { id: 'excavationWidth', label: 'Excavation width' },
  { id: 'excavationDepth', label: 'Excavation depth' },
  { id: 'custom', label: 'Custom' },
];

export const PHOTO_LABELS = [
  'Looking North',
  'Looking South',
  'Existing Utility',
  'Pothole',
  'Measurement',
  'Completed Crossing',
  'Custom',
];

export const ADD_ITEMS = [
  { kind: 'pipeline', label: 'Pipeline', hint: 'Carrier / inspected line' },
  { kind: 'utility', label: 'Existing utility', hint: 'Known type / owner' },
  { kind: 'unknown', label: 'Unknown utility', hint: 'Do not guess type' },
  { kind: 'ground', label: 'Ground surface', hint: 'Profile grade line' },
  { kind: 'excavation', label: 'Pothole / excavation', hint: 'Bell hole outline' },
  { kind: 'road', label: 'Road', hint: 'Plan view' },
  { kind: 'fence', label: 'Fence', hint: 'Plan view' },
  { kind: 'ditch', label: 'Ditch', hint: 'Plan view' },
  { kind: 'valve', label: 'Valve', hint: 'Symbol' },
  { kind: 'testStation', label: 'Test station', hint: 'Symbol' },
];

export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatMdY(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getMonth() + 1)}/${pad(dt.getDate())}/${dt.getFullYear()}`;
}

export function blankMeta(settings = {}) {
  return {
    project: '',
    lineName: '',
    station: settings.currentStation || '',
    date: todayISO(),
    inspector: settings.inspectorName || '',
    contractor: '',
    foreman: '',
    location: '',
    crossingType: 'Underground',
    notes: '',
    lat: '',
    lon: '',
    gpsAccuracy: '',
    gpsSource: 'manual', // FUTURE: 'auto' when store.getGps is wired as default
  };
}

export function blankCrossing(settings = {}) {
  const meta = blankMeta(settings);
  return {
    format: FORMAT,
    id: uid(),
    displayName: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta,
    objects: [],
    photos: [],
    cameraPlan: { x: 0, y: 0, scale: 1 },
    cameraProfile: { x: 0, y: 0, scale: 1 },
  };
}

export function makeDisplayName(meta) {
  const line = String(meta?.lineName || '').trim() || 'Line';
  const sta = String(meta?.station || '').trim();
  const staPart = sta ? `Sta ${sta}` : 'Sta —';
  const datePart = formatMdY(meta?.date) || formatMdY(todayISO());
  return `${line} – ${staPart} – ${datePart}`;
}

export function measureTypeLabel(id) {
  return MEASURE_TYPES.find((m) => m.id === id)?.label || 'Measurement';
}

/**
 * Parse inspector-entered length. Returns feet when parseable; otherwise
 * keeps the display string only. Never invents a value.
 *
 * Accepts: 3'-4"  3' 4"  3ft 4in  3.33  3.33'  40"  3 ft
 */
export function parseLength(text) {
  const display = String(text ?? '').trim();
  if (!display) return { feet: null, display: '' };

  const t = display
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/feet|foot/g, 'ft')
    .replace(/inches|inch/g, 'in')
    .replace(/\s+/g, ' ')
    .trim();

  let feet = 0;
  let matched = false;

  const ftIn = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:ft|')\s*[-+]?\s*(\d+(?:\.\d+)?)\s*(?:in|")?$/);
  if (ftIn) {
    feet = Number(ftIn[1]) + Number(ftIn[2]) / 12;
    matched = true;
  } else {
    const onlyFt = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:ft|')$/);
    const onlyIn = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:in|")$/);
    const decimal = t.match(/^(-?\d+(?:\.\d+)?)$/);
    if (onlyFt) {
      feet = Number(onlyFt[1]);
      matched = true;
    } else if (onlyIn) {
      feet = Number(onlyIn[1]) / 12;
      matched = true;
    } else if (decimal) {
      feet = Number(decimal[1]);
      matched = true;
    }
  }

  if (!matched || !Number.isFinite(feet)) return { feet: null, display };
  return { feet, display };
}

export function emptyPipelineProps(station = '') {
  return {
    name: '',
    diameter: '',
    material: '',
    coating: '',
    station: station || '',
    depth: '',
    direction: '',
    notes: '',
  };
}

export function emptyUtilityProps(type = '') {
  return {
    type: type || '',
    diameter: '',
    material: '',
    owner: '',
    depth: '',
    direction: '',
    status: type === 'Unknown' ? 'Unknown' : 'Active',
    notes: '',
  };
}

function lineGeom(x1, y1, x2, y2) {
  return { type: 'line', x1, y1, x2, y2 };
}

function pointGeom(x, y, extra = {}) {
  return { type: 'point', x, y, ...extra };
}

function rectGeom(x, y, w, h) {
  return { type: 'rect', x, y, w, h, rotation: 0 };
}

function polyGeom(points) {
  return { type: 'poly', points: points.map((p) => ({ x: p.x, y: p.y })) };
}

/** Place a new object at the visual center of the current view. */
export function makeObject(kind, view, cx, cy, meta = {}) {
  const id = uid();
  const L = 160;
  const half = L / 2;

  if (kind === 'pipeline') {
    return {
      id,
      kind,
      plan: lineGeom(cx - half - 20, cy, cx + half + 20, cy),
      profile: lineGeom(cx - half - 20, cy + 36, cx + half + 20, cy + 36),
      props: emptyPipelineProps(meta.station || ''),
    };
  }

  if (kind === 'utility' || kind === 'unknown') {
    const unknown = kind === 'unknown';
    const type = unknown ? 'Unknown' : '';
    const horiz = view === 'profile';
    const plan = horiz
      ? lineGeom(cx - 50, cy - half, cx - 50, cy + half)
      : lineGeom(cx, cy - half, cx, cy + half);
    const profile = lineGeom(cx - half, cy - 28, cx + half, cy - 28);
    return {
      id,
      kind: unknown ? 'unknown' : 'utility',
      plan,
      profile,
      props: emptyUtilityProps(type),
    };
  }

  if (kind === 'measurement') {
    return {
      id,
      kind,
      view,
      geom: lineGeom(cx - 70, cy - 40, cx - 70, cy + 40),
      props: {
        measureType: 'verticalClearance',
        valueText: '',
        valueFeet: null,
        label: '',
      },
    };
  }

  if (kind === 'label') {
    return {
      id,
      kind,
      view,
      geom: pointGeom(cx, cy),
      props: { text: '' },
    };
  }

  if (kind === 'arrow') {
    return {
      id,
      kind,
      view,
      geom: lineGeom(cx - 50, cy, cx + 50, cy),
      props: { text: '' },
    };
  }

  if (kind === 'north') {
    return {
      id,
      kind,
      view: 'plan',
      geom: pointGeom(cx + 80, cy - 90, { rotation: 0 }),
      props: {},
    };
  }

  if (kind === 'ground') {
    const pts = [
      { x: cx - 140, y: cy - 80 },
      { x: cx - 40, y: cy - 70 },
      { x: cx + 40, y: cy - 74 },
      { x: cx + 140, y: cy - 68 },
    ];
    const obj = { id, kind, plan: null, profile: null, props: { notes: '' } };
    obj[view] = polyGeom(pts);
    if (view === 'plan') obj.profile = polyGeom(pts.map((p) => ({ x: p.x, y: p.y + 10 })));
    else obj.plan = polyGeom(pts);
    return obj;
  }

  if (kind === 'excavation') {
    return {
      id,
      kind,
      plan: rectGeom(cx, cy, 90, 70),
      profile: rectGeom(cx, cy + 10, 90, 50),
      props: { type: 'pothole', width: '', depth: '', notes: '' },
    };
  }

  if (kind === 'bellhole') {
    return {
      id,
      kind: 'excavation',
      plan: rectGeom(cx, cy, 120, 90),
      profile: rectGeom(cx, cy + 20, 120, 70),
      props: { type: 'bellhole', width: '', depth: '', notes: '' },
    };
  }

  if (kind === 'road') {
    return {
      id,
      kind,
      plan: lineGeom(cx - half - 40, cy - 70, cx + half + 40, cy - 70),
      profile: null,
      props: { notes: '' },
    };
  }

  if (kind === 'fence') {
    return {
      id,
      kind,
      plan: lineGeom(cx - half, cy + 90, cx + half, cy + 90),
      profile: null,
      props: { notes: '' },
    };
  }

  if (kind === 'ditch') {
    return {
      id,
      kind,
      plan: lineGeom(cx - half, cy + 110, cx + half, cy + 110),
      profile: null,
      props: { notes: '' },
    };
  }

  if (kind === 'valve') {
    return {
      id,
      kind,
      plan: pointGeom(cx + 40, cy),
      profile: null,
      props: { notes: '' },
    };
  }

  if (kind === 'testStation') {
    return {
      id,
      kind,
      plan: pointGeom(cx - 40, cy - 30),
      profile: null,
      props: { notes: '' },
    };
  }

  return { id, kind: 'label', view, geom: pointGeom(cx, cy), props: { text: kind } };
}

export function getGeom(obj, view) {
  if (!obj) return null;
  if (obj.kind === 'measurement' || obj.kind === 'label' || obj.kind === 'arrow' || obj.kind === 'north') {
    if ((obj.view || 'plan') !== view) return null;
    return obj.geom || null;
  }
  return obj[view] || null;
}

export function setGeom(obj, view, geom) {
  if (obj.kind === 'measurement' || obj.kind === 'label' || obj.kind === 'arrow' || obj.kind === 'north') {
    obj.geom = geom;
    return;
  }
  obj[view] = geom;
}

export function geomBounds(g) {
  if (!g) return null;
  if (g.type === 'line') {
    return {
      minX: Math.min(g.x1, g.x2),
      minY: Math.min(g.y1, g.y2),
      maxX: Math.max(g.x1, g.x2),
      maxY: Math.max(g.y1, g.y2),
    };
  }
  if (g.type === 'point') {
    return { minX: g.x - 20, minY: g.y - 20, maxX: g.x + 20, maxY: g.y + 20 };
  }
  if (g.type === 'rect') {
    const hw = (g.w || 0) / 2;
    const hh = (g.h || 0) / 2;
    return { minX: g.x - hw, minY: g.y - hh, maxX: g.x + hw, maxY: g.y + hh };
  }
  if (g.type === 'poly' && g.points?.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of g.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }
  return null;
}

export function unionBounds(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  return list.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function offsetGeom(g, dx, dy) {
  if (!g) return g;
  if (g.type === 'line') return { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy };
  if (g.type === 'point') return { ...g, x: g.x + dx, y: g.y + dy };
  if (g.type === 'rect') return { ...g, x: g.x + dx, y: g.y + dy };
  if (g.type === 'poly') return { ...g, points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return g;
}

export function cloneObject(obj, dx = 24, dy = 24) {
  const copy = JSON.parse(JSON.stringify(obj));
  copy.id = uid();
  if (copy.plan) copy.plan = offsetGeom(copy.plan, dx, dy);
  if (copy.profile) copy.profile = offsetGeom(copy.profile, dx, dy);
  if (copy.geom) copy.geom = offsetGeom(copy.geom, dx, dy);
  return copy;
}

export function isUnknownUtility(obj) {
  if (!obj) return false;
  if (obj.kind === 'unknown') return true;
  if (obj.kind === 'utility' && String(obj.props?.type || '') === 'Unknown') return true;
  return false;
}

export function utilityLabel(obj) {
  if (isUnknownUtility(obj)) return 'UNKNOWN UTILITY';
  const t = String(obj.props?.type || '').trim();
  return t || 'Utility';
}

export function pipelineCaption(obj) {
  const p = obj.props || {};
  const bits = [];
  if (p.name) bits.push(p.name);
  if (p.diameter) bits.push(p.diameter.includes('"') ? p.diameter : `${p.diameter}"`);
  if (p.material) bits.push(p.material);
  if (p.station) bits.push(`Sta ${p.station}`);
  if (p.depth) bits.push(`cover ${p.depth}`);
  if (p.direction) bits.push(p.direction);
  return bits.join('  ·  ') || 'Pipeline';
}

export function utilityCaption(obj) {
  if (isUnknownUtility(obj)) {
    const p = obj.props || {};
    const bits = ['UNKNOWN UTILITY'];
    if (p.diameter) bits.push(p.diameter);
    if (p.depth) bits.push(`d ${p.depth}`);
    if (p.status && p.status !== 'Unknown') bits.push(p.status);
    return bits.join('  ·  ');
  }
  const p = obj.props || {};
  const bits = [];
  if (p.type) bits.push(p.type);
  if (p.diameter) bits.push(p.diameter.includes('"') ? p.diameter : `${p.diameter}"`);
  if (p.material) bits.push(p.material);
  if (p.owner) bits.push(p.owner);
  if (p.depth) bits.push(`d ${p.depth}`);
  if (p.status && p.status !== 'Active') bits.push(p.status);
  return bits.join('  ·  ') || 'Utility';
}

export function collectUtilityTypes(objects) {
  const set = new Set();
  for (const o of objects || []) {
    if (o.kind === 'unknown') set.add('Unknown');
    if (o.kind === 'utility') set.add(o.props?.type || 'Unknown');
  }
  return [...set];
}

export function indexEntry(record) {
  return {
    id: record.id,
    displayName: record.displayName || makeDisplayName(record.meta),
    project: record.meta?.project || '',
    lineName: record.meta?.lineName || '',
    station: record.meta?.station || '',
    date: record.meta?.date || '',
    inspector: record.meta?.inspector || '',
    crossingType: record.meta?.crossingType || '',
    utilityTypes: collectUtilityTypes(record.objects),
    updatedAt: record.updatedAt,
    photoCount: record.photos?.length || 0,
  };
}

export function serializeCrossing(record) {
  const meta = { ...(record.meta || blankMeta()) };
  const objects = JSON.parse(JSON.stringify(record.objects || []));
  const photos = (record.photos || []).map((p) => ({
    id: p.id,
    label: p.label || '',
    customLabel: p.customLabel || '',
    dataUrl: p.dataUrl || '',
    addedAt: p.addedAt || '',
  }));
  const displayName = makeDisplayName(meta);
  return {
    format: FORMAT,
    id: record.id,
    displayName,
    createdAt: record.createdAt,
    updatedAt: new Date().toISOString(),
    meta,
    objects,
    photos,
    cameraPlan: record.cameraPlan || { x: 0, y: 0, scale: 1 },
    cameraProfile: record.cameraProfile || { x: 0, y: 0, scale: 1 },
  };
}

export function parseCrossing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = blankCrossing();
  const meta = { ...base.meta, ...(raw.meta || {}) };
  const objects = Array.isArray(raw.objects) ? raw.objects : [];
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  return {
    format: FORMAT,
    id: raw.id || uid(),
    displayName: raw.displayName || makeDisplayName(meta),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    meta,
    objects,
    photos,
    cameraPlan: raw.cameraPlan || { x: 0, y: 0, scale: 1 },
    cameraProfile: raw.cameraProfile || { x: 0, y: 0, scale: 1 },
  };
}

/** Node/browser round-trip used in verification. */
export function roundTrip(record) {
  const json = JSON.stringify(serializeCrossing(record));
  const back = parseCrossing(JSON.parse(json));
  return { json, record: back, ok: back && back.id === record.id && Array.isArray(back.objects) };
}

export function matchesQuery(entry, q) {
  const s = String(q || '')
    .trim()
    .toLowerCase();
  if (!s) return true;
  const blob = [
    entry.displayName,
    entry.project,
    entry.lineName,
    entry.station,
    entry.date,
    formatMdY(entry.date),
    entry.inspector,
    entry.crossingType,
    (entry.utilityTypes || []).join(' '),
  ]
    .join(' ')
    .toLowerCase();
  return blob.includes(s);
}

export function fileSlug(record) {
  const raw = `${record.meta?.lineName || 'line'}-${record.meta?.station || record.id}`.replace(
    /[^a-zA-Z0-9+_]+/g,
    '-'
  );
  return raw.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || record.id;
}
