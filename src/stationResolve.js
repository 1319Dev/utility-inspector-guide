/**
 * Shared station resolve — live estimate / pin snap from saved KMZ, or settings fallback.
 * Used by Station Locator consumers (Photo Stamp, Bell Hole) without opening that tool.
 */
import { getGps, loadSettings, saveSettings } from './store.js';

const DB_NAME = 'uig-stations';
const DB_VER = 1;
const STORE = 'maps';
const DOC_KEY = 'current';
const EARTH_M = 6371000;

const STATION_HINT =
  /\b(?:sta(?:tion)?\.?\s*|mp\.?\s*|kp\.?\s*|mile\s*post\.?\s*|chainage\.?\s*)?(\d{1,4}\s*\+\s*\d{1,3}|\d{3,5})\b/i;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function loadStationMap() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(DOC_KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function stationToFeet(name) {
  const s = String(name || '').trim();
  const plus = s.match(/(\d{1,4})\s*\+\s*(\d{1,3})/);
  if (plus) return Number(plus[1]) * 100 + Number(plus[2]);
  const bare = s.match(/^(\d{3,5})$/);
  if (bare) return Number(bare[1]);
  const m = s.match(STATION_HINT);
  if (m) {
    const token = m[1].replace(/\s+/g, '');
    if (token.includes('+')) {
      const [a, b] = token.split('+');
      return Number(a) * 100 + Number(b);
    }
    const n = Number(token);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function formatStationFeet(ft) {
  if (!Number.isFinite(ft)) return '—';
  const rounded = Math.round(ft);
  const maj = Math.floor(rounded / 100);
  const min = ((rounded % 100) + 100) % 100;
  return `${maj}+${String(min).padStart(2, '0')}`;
}

function stationsWithChainage(mapData) {
  if (!mapData?.stations?.length) return [];
  return mapData.stations
    .map((s) => ({ ...s, chainFt: stationToFeet(s.name) }))
    .filter((s) => Number.isFinite(s.chainFt))
    .sort((a, b) => a.chainFt - b.chainFt);
}

function nearestStation(mapData, gps) {
  if (!mapData?.stations?.length || !gps) return null;
  let best = null;
  for (const s of mapData.stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const distM = haversineM(gps, s);
    if (!best || distM < best.distM) best = { ...s, distM };
  }
  return best;
}

/** Project GPS onto segment between two station pins; interpolate chainage. */
export function interpolateChainage(gps, sorted) {
  if (!gps || sorted.length < 2) return null;
  let best = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const cosLat = Math.cos((gps.lat * Math.PI) / 180);
    const toXY = (p) => ({
      x: (((p.lon - gps.lon) * Math.PI) / 180) * EARTH_M * cosLat,
      y: (((p.lat - gps.lat) * Math.PI) / 180) * EARTH_M,
    });
    const A = toXY(a);
    const B = toXY(b);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? (-A.x * dx + -A.y * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = A.x + t * dx;
    const py = A.y + t * dy;
    const distM = Math.hypot(px, py);
    const chainFt = a.chainFt + t * (b.chainFt - a.chainFt);
    if (!best || distM < best.distM) {
      best = { chainFt, distM, from: a, to: b, t };
    }
  }
  return best;
}

/**
 * Resolve station from map + GPS using live interpolate or nearest pin.
 * @returns {{ label: string|null, source: 'live'|'pin'|'live-fallback'|null, detail: string, nearest: object|null }}
 */
export function resolveFromMap(mapData, gps, mode = 'live') {
  const nearest = nearestStation(mapData, gps);
  if (mode === 'pin') {
    return {
      label: nearest?.name || null,
      source: nearest ? 'pin' : null,
      detail: nearest ? `Nearest pin` : 'No station pin',
      nearest,
    };
  }
  const sorted = stationsWithChainage(mapData);
  if (sorted.length >= 2 && gps) {
    const interp = interpolateChainage(gps, sorted);
    if (interp) {
      const label = formatStationFeet(interp.chainFt);
      return {
        label,
        source: 'live',
        detail: `Live estimate · between ${interp.from.name}–${interp.to.name}`,
        nearest,
      };
    }
  }
  if (nearest) {
    return {
      label: nearest.name,
      source: 'live-fallback',
      detail: 'Nearest pin (need ≥2 chainage pins for foot estimate)',
      nearest,
    };
  }
  return { label: null, source: null, detail: 'No stations', nearest: null };
}

/**
 * Best current station for Photo Stamp / Bell Hole.
 * Prefer KMZ+GPS live/pin; else saved settings.currentStation.
 *
 * @param {{ gps?: {lat:number,lon:number}|null, mode?: 'live'|'pin', fetchGps?: boolean }} [opts]
 * @returns {Promise<{ label: string|null, source: 'live'|'pin'|'live-fallback'|'saved'|null, detail: string, gps: object|null }>}
 */
export async function resolveStation(opts = {}) {
  const settings = loadSettings();
  const mode = opts.mode === 'pin' || opts.mode === 'live' ? opts.mode : settings.stationMode === 'pin' ? 'pin' : 'live';

  let gps = opts.gps !== undefined ? opts.gps : null;
  if (gps == null && opts.fetchGps !== false) {
    gps = await getGps();
  }

  const mapData = await loadStationMap();
  if (mapData?.stations?.length && gps) {
    const fromMap = resolveFromMap(mapData, gps, mode);
    if (fromMap.label) {
      return {
        label: fromMap.label,
        source: fromMap.source,
        detail: fromMap.detail,
        gps,
      };
    }
  }

  const saved = String(settings.currentStation || '').trim();
  if (saved) {
    return {
      label: saved,
      source: 'saved',
      detail: mapData?.stations?.length
        ? 'Saved station (GPS or live resolve unavailable)'
        : 'Saved station (no KMZ loaded)',
      gps,
    };
  }

  return {
    label: null,
    source: null,
    detail: mapData?.stations?.length
      ? 'KMZ loaded — need GPS for live station'
      : 'No station yet — open Station Locator',
    gps,
  };
}

/** Human status line for UI. */
export function stationStatusText(result) {
  if (!result?.label) {
    return result?.detail || 'No station yet — open Station Locator';
  }
  const tag =
    result.source === 'live' || result.source === 'live-fallback'
      ? 'live'
      : result.source === 'pin'
        ? 'pin'
        : result.source === 'saved'
          ? 'saved'
          : 'ok';
  return `Station auto: ${result.label} (${tag})`;
}

/**
 * Fill an input + optional status element; persist currentStation when label found.
 * @returns {Promise<object>} resolveStation result
 */
export async function autofillStationField(inputEl, statusEl, opts = {}) {
  const result = await resolveStation(opts);
  if (statusEl) statusEl.textContent = stationStatusText(result);
  if (result.label && inputEl) {
    inputEl.value = result.label;
    saveSettings({ currentStation: result.label });
  }
  return result;
}
