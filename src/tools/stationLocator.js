/**
 * Station Locator — upload KMZ/KML, GPS nearest station (+ nearby features)
 */
import JSZip from 'jszip';
import { formatStamp, loadSettings, saveSettings, fmtGps } from '../store.js';

const DB_NAME = 'uig-stations';
const DB_VER = 1;
const STORE = 'maps';
const DOC_KEY = 'current';
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const EARTH_M = 6371000;

let root = null;
let mapData = null; // { name, uploadedAt, stations: [], features: [] }
let watchId = null;
let lastGps = null;
let filterMode = 'stations'; // 'stations' | 'all'

const FEATURE_HINT =
  /\b(power\s*pole|utility\s*pole|pole|property\s*line|prop\.?\s*line|tws|temp(?:orary)?\s*work(?:ing)?\s*space|workspace|work\s*space|row|right[\s-]?of[\s-]?way|easement|fence|gate|hydrant|valve|marker|sign|building|structure|tree|culvert|ditch|drain|wetland|bore|hdd|temp(?:orary)?\s*workspace)\b/i;

const STATION_HINT =
  /\b(?:sta(?:tion)?\.?\s*|mp\.?\s*|kp\.?\s*|mile\s*post\.?\s*|chainage\.?\s*)?(\d{1,4}\s*\+\s*\d{1,3}|\d{3,5})\b/i;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

async function idbGet() {
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

async function idbSet(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, DOC_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(DOC_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

function localName(el) {
  if (!el || el.nodeType !== 1) return '';
  return (el.localName || el.tagName || '').split(':').pop().toLowerCase();
}

function textOf(el) {
  return (el?.textContent || '').trim();
}

function findChildren(parent, name) {
  const out = [];
  if (!parent) return out;
  for (const c of parent.children || []) {
    if (localName(c) === name) out.push(c);
  }
  return out;
}

function findDescendants(rootEl, name) {
  const out = [];
  const walk = (n) => {
    if (!n || n.nodeType !== 1) return;
    if (localName(n) === name) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(rootEl);
  return out;
}

function firstDescendant(rootEl, name) {
  return findDescendants(rootEl, name)[0] || null;
}

function parseCoordPair(raw) {
  const parts = String(raw || '')
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 2) return null;
  const lon = parts[0];
  const lat = parts[1];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function parseCoordinatesText(text) {
  const pts = [];
  const chunks = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const chunk of chunks) {
    const p = parseCoordPair(chunk.replace(/\s/g, ''));
    if (p) pts.push(p);
  }
  // also handle "lon,lat,alt lon,lat,alt" already split; if single blob with commas only
  if (!pts.length && text.includes(',')) {
    const tuples = String(text).trim().split(/\s+/);
    for (const t of tuples) {
      const p = parseCoordPair(t);
      if (p) pts.push(p);
    }
  }
  return pts;
}

function midpoint(pts) {
  if (!pts.length) return null;
  let lat = 0;
  let lon = 0;
  for (const p of pts) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

function normalizeStationLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(STATION_HINT);
  if (!m) return s;
  let token = m[1].replace(/\s+/g, '');
  if (token.includes('+')) {
    const [a, b] = token.split('+');
    return `${Number(a)}+${String(b).padStart(2, '0')}`;
  }
  // bare feet → station format if looks like chainage
  const n = Number(token);
  if (Number.isFinite(n) && n >= 100) {
    const maj = Math.floor(n / 100);
    const min = Math.round(n % 100);
    return `${maj}+${String(min).padStart(2, '0')}`;
  }
  return token;
}

function looksLikeStation(name, description) {
  const blob = `${name || ''} ${description || ''}`.trim();
  if (!blob) return false;
  if (FEATURE_HINT.test(blob) && !STATION_HINT.test(blob)) return false;
  // Strong station patterns
  if (/\bsta(?:tion)?\.?\s*\d/i.test(blob)) return true;
  if (/\b(?:mp|kp)\.?\s*\d/i.test(blob)) return true;
  if (/\d{1,4}\s*\+\s*\d{1,3}/.test(blob)) return true;
  // Bare chainage-like number as primary name (e.g. "1200", "12+00")
  const nameOnly = String(name || '').trim();
  if (/^\d{1,4}\s*\+\s*\d{1,3}$/.test(nameOnly)) return true;
  if (/^\d{3,5}$/.test(nameOnly) && Number(nameOnly) % 50 === 0) return true;
  if (STATION_HINT.test(blob) && !FEATURE_HINT.test(blob)) return true;
  return false;
}

function featureKind(name, description) {
  const blob = `${name || ''} ${description || ''}`.toLowerCase();
  if (/power\s*pole|utility\s*pole|(^|\b)pole\b/.test(blob)) return 'Power pole';
  if (/property\s*line|prop\.?\s*line/.test(blob)) return 'Property line';
  if (/\btws\b|temp(?:orary)?\s*work|workspace|work\s*space/.test(blob)) return 'TWS / workspace';
  if (/\brow\b|right[\s-]?of[\s-]?way|easement/.test(blob)) return 'ROW / easement';
  if (/fence|gate/.test(blob)) return 'Fence / gate';
  if (/valve|hydrant/.test(blob)) return 'Valve / hydrant';
  if (/culvert|ditch|drain/.test(blob)) return 'Drainage';
  return 'Feature';
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

function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compass(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}

function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  const ft = m * 3.280839895;
  if (ft < 10) return `${ft.toFixed(1)} ft (${m.toFixed(1)} m)`;
  if (ft < 1000) return `${Math.round(ft)} ft (${m < 100 ? m.toFixed(1) : Math.round(m)} m)`;
  return `${(ft / 5280).toFixed(2)} mi (${(m / 1000).toFixed(2)} km)`;
}

/** Distance from point to polyline (meters) using local equirectangular segments */
function distToPolylineM(gps, pts) {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return haversineM(gps, pts[0]);
  let best = Infinity;
  const cosLat = Math.cos((gps.lat * Math.PI) / 180);
  const toXY = (p) => ({
    x: ((p.lon - gps.lon) * Math.PI) / 180 * EARTH_M * cosLat,
    y: ((p.lat - gps.lat) * Math.PI) / 180 * EARTH_M,
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = toXY(pts[i]);
    const b = toXY(pts[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? (-a.x * dx + -a.y * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

function extractPlacemarkGeometry(pm) {
  const name = textOf(firstDescendant(pm, 'name'));
  const description = textOf(firstDescendant(pm, 'description'));
  const point = firstDescendant(pm, 'point');
  const line = firstDescendant(pm, 'linestring');
  const track = firstDescendant(pm, 'track');

  let pointCoord = null;
  let linePts = [];

  if (point) {
    const coordsEl = firstDescendant(point, 'coordinates');
    const pts = parseCoordinatesText(textOf(coordsEl));
    if (pts[0]) pointCoord = pts[0];
  }

  if (line) {
    const coordsEl = firstDescendant(line, 'coordinates');
    linePts = parseCoordinatesText(textOf(coordsEl));
  }

  if (track) {
    // gx:Track uses <gx:coord>lon lat alt</gx:coord>
    const coords = findDescendants(track, 'coord');
    for (const c of coords) {
      const p = parseCoordPair(textOf(c));
      if (p) linePts.push(p);
    }
  }

  return { name, description, pointCoord, linePts };
}

function classifyPlacemark(geom) {
  const { name, description, pointCoord, linePts } = geom;
  const isStation = looksLikeStation(name, description);
  const label = isStation ? normalizeStationLabel(name || description) : name || description || 'Unnamed';

  if (isStation && pointCoord) {
    return {
      kind: 'station',
      item: {
        name: label,
        rawName: name,
        description,
        lat: pointCoord.lat,
        lon: pointCoord.lon,
        geom: 'point',
      },
    };
  }

  // Station-like name but only a line → use midpoint as station snap
  if (isStation && linePts.length) {
    const mid = midpoint(linePts);
    if (mid) {
      return {
        kind: 'station',
        item: {
          name: label,
          rawName: name,
          description,
          lat: mid.lat,
          lon: mid.lon,
          geom: 'line-mid',
        },
      };
    }
  }

  // Features: points and/or lines
  if (pointCoord || linePts.length) {
    return {
      kind: 'feature',
      item: {
        name: name || description || 'Unnamed feature',
        description,
        type: featureKind(name, description),
        lat: pointCoord?.lat ?? midpoint(linePts)?.lat,
        lon: pointCoord?.lon ?? midpoint(linePts)?.lon,
        linePts: linePts.length >= 2 ? linePts : null,
        geom: pointCoord ? 'point' : 'line',
      },
    };
  }

  return null;
}

function parseKmlText(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Could not parse KML XML.');
  }
  const rootEl = doc.documentElement;
  const placemarks = findDescendants(rootEl, 'placemark');
  const stations = [];
  const features = [];
  const seenSta = new Set();

  for (const pm of placemarks) {
    const geom = extractPlacemarkGeometry(pm);
    const classified = classifyPlacemark(geom);
    if (!classified) continue;
    if (classified.kind === 'station') {
      const key = `${classified.item.name}|${classified.item.lat.toFixed(6)}|${classified.item.lon.toFixed(6)}`;
      if (seenSta.has(key)) continue;
      seenSta.add(key);
      stations.push(classified.item);
    } else {
      features.push(classified.item);
    }
  }

  return { stations, features, placemarkCount: placemarks.length };
}

function isZipMagic(u8) {
  return (
    u8 &&
    u8.length >= 4 &&
    u8[0] === 0x50 &&
    u8[1] === 0x4b &&
    (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07)
  );
}

function looksLikeKmlText(text) {
  const head = String(text || '')
    .slice(0, 600)
    .toLowerCase();
  return head.includes('<kml') || (head.includes('<?xml') && head.includes('kml'));
}

function decodeText(buf) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/** Resolve a relative href against a zip entry path (no external http(s)). */
function resolveZipHref(basePath, href) {
  let h = String(href || '')
    .trim()
    .replace(/^file:\/+/i, '');
  h = h.split('#')[0].split('?')[0].replace(/\\/g, '/');
  if (!h || /^(https?:|mailto:|javascript:)/i.test(h)) return null;
  h = h.replace(/^\.\//, '');
  const baseDir = basePath.includes('/') ? basePath.replace(/\/[^/]+$/, '/') : '';
  const joined = (h.startsWith('/') ? h.slice(1) : baseDir + h).replace(/\/+/g, '/');
  const parts = joined.split('/');
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (out.length) out.pop();
    } else {
      out.push(p);
    }
  }
  return out.join('/');
}

function findEntry(fileMap, path) {
  if (!path) return null;
  if (fileMap[path]) return path;
  const lower = path.toLowerCase();
  for (const n of Object.keys(fileMap)) {
    if (n.toLowerCase() === lower) return n;
  }
  // basename fallback (Google Earth sometimes uses bare names)
  const base = path.split('/').pop().toLowerCase();
  const matches = Object.keys(fileMap).filter((n) => n.split('/').pop().toLowerCase() === base);
  return matches.length === 1 ? matches[0] : null;
}

function networkLinkHrefs(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const hrefs = [];
  for (const nl of findDescendants(doc.documentElement, 'networklink')) {
    for (const h of findDescendants(nl, 'href')) {
      const t = textOf(h);
      if (t) hrefs.push(t);
    }
  }
  return hrefs;
}

/**
 * Google Earth often ships a doc.kml that only NetworkLinks other .kml files
 * inside the same KMZ. Follow those links and also pick up any leftover .kml.
 */
async function collectKmlTextsFromZip(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const fileMap = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) fileMap[name] = entry;
  }
  const kmlNames = Object.keys(fileMap).filter((n) => /\.kml$/i.test(n));
  if (!kmlNames.length) throw new Error('No .kml found inside KMZ.');

  const visited = new Set();
  const kmlTexts = [];

  async function visit(path) {
    const real = findEntry(fileMap, path);
    if (!real) return;
    const key = real.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    const entry = fileMap[real];

    if (/\.kmz$/i.test(real)) {
      const nested = await collectKmlTextsFromZip(await entry.async('arraybuffer'));
      for (const t of nested) kmlTexts.push(t);
      return;
    }
    if (!/\.kml$/i.test(real)) return;

    const text = await entry.async('string');
    kmlTexts.push(text);
    for (const href of networkLinkHrefs(text)) {
      const resolved = resolveZipHref(real, href);
      if (resolved) await visit(resolved);
    }
  }

  const start =
    kmlNames.find((n) => /(^|\/)doc\.kml$/i.test(n)) ||
    kmlNames[0];
  await visit(start);
  for (const n of kmlNames) await visit(n);

  if (!kmlTexts.length) throw new Error('No readable KML inside KMZ.');
  return kmlTexts;
}

function mergeParsedKml(parts) {
  const stations = [];
  const features = [];
  let placemarkCount = 0;
  const seenSta = new Set();
  for (const p of parts) {
    placemarkCount += p.placemarkCount || 0;
    for (const s of p.stations || []) {
      const key = `${s.name}|${Number(s.lat).toFixed(6)}|${Number(s.lon).toFixed(6)}`;
      if (seenSta.has(key)) continue;
      seenSta.add(key);
      stations.push(s);
    }
    for (const f of p.features || []) features.push(f);
  }
  return { stations, features, placemarkCount };
}

async function readKmzOrKml(file) {
  const lower = String(file.name || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const headText = decodeText(u8.slice(0, Math.min(u8.length, 800)));

  const mimeKml =
    mime === 'application/vnd.google-earth.kml+xml' ||
    mime === 'application/xml' ||
    mime === 'text/xml' ||
    mime === 'text/plain';
  const mimeKmz =
    mime === 'application/vnd.google-earth.kmz' ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/octet-stream';

  const wantKml =
    lower.endsWith('.kml') || (mimeKml && !lower.endsWith('.kmz') && looksLikeKmlText(headText));
  const wantKmz =
    lower.endsWith('.kmz') ||
    mime === 'application/vnd.google-earth.kmz' ||
    ((mimeKmz || !mime) && isZipMagic(u8));

  if (wantKml && !isZipMagic(u8)) {
    const kmlText = decodeText(u8);
    if (!looksLikeKmlText(kmlText)) {
      throw new Error('That file does not look like KML.');
    }
    return { kmlTexts: [kmlText], sourceName: file.name || 'map.kml' };
  }

  if (wantKmz || isZipMagic(u8)) {
    const kmlTexts = await collectKmlTextsFromZip(buf);
    return { kmlTexts, sourceName: file.name || 'map.kmz' };
  }

  if (looksLikeKmlText(headText)) {
    return { kmlTexts: [decodeText(u8)], sourceName: file.name || 'map.kml' };
  }

  throw new Error('Please upload a .kmz or .kml file (iOS: use Files / Browse if Photos is shown).');
}


function stopWatch() {
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}

function startWatch() {
  stopWatch();
  const gpsLabel = root?.querySelector('#sl-gps');
  if (!navigator.geolocation) {
    if (gpsLabel) gpsLabel.textContent = 'GPS not available on this device.';
    return;
  }
  if (gpsLabel) gpsLabel.textContent = 'Getting GPS…';
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastGps = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      updateReadout();
    },
    (err) => {
      lastGps = null;
      if (gpsLabel) {
        const msg =
          err?.code === 1
            ? 'Location permission denied. Enable GPS for this site.'
            : err?.code === 2
              ? 'Position unavailable.'
              : err?.code === 3
                ? 'GPS timed out — move outdoors or retry.'
                : 'GPS error.';
        gpsLabel.textContent = msg;
      }
      updateReadout();
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

function rankStations(gps) {
  if (!mapData?.stations?.length || !gps) return [];
  return mapData.stations
    .map((s) => {
      const distM = haversineM(gps, s);
      const brg = bearingDeg(gps, s);
      return { ...s, distM, bearing: brg, compass: compass(brg) };
    })
    .sort((a, b) => a.distM - b.distM);
}

function rankFeatures(gps) {
  if (!mapData?.features?.length || !gps) return [];
  return mapData.features
    .map((f) => {
      let distM;
      if (f.linePts && f.linePts.length >= 2) {
        distM = distToPolylineM(gps, f.linePts);
      } else if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
        distM = haversineM(gps, f);
      } else {
        distM = Infinity;
      }
      return { ...f, distM };
    })
    .filter((f) => Number.isFinite(f.distM))
    .sort((a, b) => a.distM - b.distM);
}

function setStatus(msg, isErr = false) {
  const el = root?.querySelector('#sl-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isErr);
}

function renderMapMeta() {
  const meta = root.querySelector('#sl-map-meta');
  const live = root.querySelector('#sl-live');
  if (!mapData) {
    meta.innerHTML = '<p class="muted">No KMZ/KML loaded yet. Upload station placemarks (e.g. every 100 ft) from Google Earth.</p>';
    live.hidden = true;
    return;
  }
  meta.innerHTML = `
    <div class="list-item">
      <strong>${escapeHtml(mapData.name)}</strong>
      <span class="meta">${mapData.stations.length} stations · ${mapData.features.length} other features · ${escapeHtml(mapData.uploadedAt || '')}</span>
      <div class="btn-row">
        <button type="button" class="danger-btn" id="sl-clear">Remove map</button>
      </div>
    </div>`;
  live.hidden = false;
  meta.querySelector('#sl-clear')?.addEventListener('click', async () => {
    mapData = null;
    await idbClear();
    renderMapMeta();
    updateReadout();
    setStatus('Map removed from this device.');
  });
}

function updateReadout() {
  if (!root) return;
  const gpsEl = root.querySelector('#sl-gps');
  const nearestBox = root.querySelector('#sl-nearest');
  const nearbySta = root.querySelector('#sl-nearby-stations');
  const nearbyFeat = root.querySelector('#sl-nearby-features');
  const useBtn = root.querySelector('#sl-use');

  if (lastGps && gpsEl) {
    gpsEl.textContent = `${fmtGps(lastGps)} · live`;
  }

  if (!mapData) {
    nearestBox.innerHTML = `<div class="big">—</div><div class="muted">Upload a KMZ/KML to locate</div>`;
    nearestBox.className = 'result-box';
    nearbySta.innerHTML = '';
    nearbyFeat.innerHTML = '';
    if (useBtn) useBtn.disabled = true;
    return;
  }

  if (!lastGps) {
    nearestBox.innerHTML = `<div class="big">—</div><div class="muted">Waiting for GPS…</div>`;
    nearestBox.className = 'result-box';
    nearbySta.innerHTML = '';
    nearbyFeat.innerHTML = '';
    if (useBtn) useBtn.disabled = true;
    return;
  }

  const rankedSta = rankStations(lastGps);
  const rankedFeat = rankFeatures(lastGps);
  const nearest = rankedSta[0];

  if (!nearest) {
    nearestBox.innerHTML = `<div class="big">No stations</div><div class="muted">${mapData.features.length} other features in file — none matched station patterns (12+00, Sta 1200, …)</div>`;
    nearestBox.className = 'result-box fail';
    if (useBtn) {
      useBtn.disabled = true;
      useBtn.dataset.station = '';
    }
  } else {
    nearestBox.innerHTML = `
      <div class="muted">Nearest station</div>
      <div class="big">${escapeHtml(nearest.name)}</div>
      <div class="sl-dist">${escapeHtml(fmtDist(nearest.distM))} · ${escapeHtml(nearest.compass)} (${Math.round(nearest.bearing)}°)</div>
      <div class="muted">±${Math.round(lastGps.accuracy || 0)} m GPS accuracy</div>`;
    nearestBox.className = 'result-box pass';
    if (useBtn) {
      useBtn.disabled = false;
      useBtn.dataset.station = nearest.name;
    }
  }

  const showStaList = filterMode === 'stations' || filterMode === 'all';
  const showFeatList = filterMode === 'all' || filterMode === 'features';

  if (showStaList && rankedSta.length) {
    const top = rankedSta.slice(0, 5);
    nearbySta.innerHTML = `
      <h3>Nearby stations</h3>
      <div class="list">
        ${top
          .map(
            (s, i) => `
          <button type="button" class="list-item sl-pick" data-station="${escapeHtml(s.name)}" ${i === 0 ? 'data-nearest="1"' : ''}>
            <strong>${escapeHtml(s.name)}</strong>
            <span class="meta">${escapeHtml(fmtDist(s.distM))} · ${escapeHtml(s.compass)}</span>
          </button>`
          )
          .join('')}
      </div>`;
  } else if (showStaList) {
    nearbySta.innerHTML = `<h3>Nearby stations</h3><p class="muted">No station placemarks detected.</p>`;
  } else {
    nearbySta.innerHTML = '';
  }

  if (showFeatList && rankedFeat.length) {
    const top = rankedFeat.slice(0, 5);
    nearbyFeat.innerHTML = `
      <h3>Nearby features</h3>
      <div class="list">
        ${top
          .map(
            (f) => `
          <div class="list-item">
            <strong>${escapeHtml(f.name)}</strong>
            <span class="meta">${escapeHtml(f.type)} · ${escapeHtml(fmtDist(f.distM))}${f.geom === 'line' ? ' · to line' : ''}</span>
          </div>`
          )
          .join('')}
      </div>`;
  } else if (showFeatList) {
    nearbyFeat.innerHTML = `<h3>Nearby features</h3><p class="muted">No other features in this file.</p>`;
  } else {
    nearbyFeat.innerHTML = '';
  }

  // pick handlers
  nearbySta.querySelectorAll('.sl-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sta = btn.dataset.station;
      if (!sta) return;
      saveSettings({ currentStation: sta });
      setStatus(`Saved station ${sta} for Photo Stamp / Daily Report.`);
      root.querySelector('#sl-saved').textContent = `Current: ${sta}`;
    });
  });
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`File too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB).`, true);
    return;
  }
  setStatus(`Reading ${file.name}…`);
  const btn = root.querySelector('#sl-upload-btn');
  if (btn) btn.disabled = true;
  try {
    const { kmlTexts, sourceName } = await readKmzOrKml(file);
    const parsed = mergeParsedKml(kmlTexts.map((t) => parseKmlText(t)));
    if (!parsed.stations.length && !parsed.features.length) {
      throw new Error('No placemarks with coordinates found in that file.');
    }
    mapData = {
      name: sourceName,
      uploadedAt: formatStamp(),
      stations: parsed.stations,
      features: parsed.features,
      placemarkCount: parsed.placemarkCount,
    };
    try {
      await idbSet(mapData);
    } catch (err) {
      console.warn(err);
      setStatus(
        `Parsed ${parsed.stations.length} stations + ${parsed.features.length} features (session only — storage blocked).`,
        true
      );
      renderMapMeta();
      updateReadout();
      return;
    }
    renderMapMeta();
    updateReadout();
    const layerNote = kmlTexts.length > 1 ? ` across ${kmlTexts.length} KML layers` : '';
    setStatus(
      `Ready — ${parsed.stations.length} stations, ${parsed.features.length} other features (${parsed.placemarkCount} placemarks${layerNote}).`
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function leaveStation() {
  stopWatch();
}

export function mountStation(el) {
  root = el;
  const s = loadSettings();
  filterMode = 'stations';
  el.innerHTML = `
    <p class="muted">Upload a Google Earth <strong>KMZ/KML</strong> with station pins (e.g. every 100 ft). Your phone GPS snaps to the nearest <em>station</em>; poles, property lines, TWS, etc. show as nearby features only.</p>
    <div class="card">
      <h3>Upload map</h3>
      <div class="sow-drop" id="sl-drop" role="button" tabindex="0">
        <input type="file" id="sl-file" accept=".kmz,.kml,.zip,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml,application/zip,application/x-zip-compressed,application/octet-stream,*/*" hidden />
        <span class="sow-drop-title">Tap to choose KMZ / KML</span>
        <span class="muted">Google Earth KMZ or KML · stored on this device only</span>
      </div>
      <button type="button" class="primary-btn" id="sl-upload-btn">Choose KMZ / KML</button>
      <p class="muted" id="sl-status"></p>
      <div id="sl-map-meta"></div>
    </div>

    <div class="card" id="sl-live" hidden>
      <h3>Live location</h3>
      <p class="muted" id="sl-gps">GPS: …</p>
      <div class="segment" id="sl-filter" role="group" aria-label="Filter">
        <button type="button" class="active" data-filter="stations">Stations</button>
        <button type="button" data-filter="all">All</button>
        <button type="button" data-filter="features">Features</button>
      </div>
      <div class="result-box" id="sl-nearest"><div class="big">—</div></div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="primary-btn" id="sl-use" disabled>Use this station</button>
        <button type="button" class="secondary-btn" id="sl-refresh">Refresh GPS</button>
      </div>
      <p class="muted" id="sl-saved">${s.currentStation ? `Current: ${escapeHtml(s.currentStation)}` : 'No station saved yet.'}</p>
      <div id="sl-nearby-stations" class="sl-section"></div>
      <div id="sl-nearby-features" class="sl-section"></div>
      <p class="disclaimer muted">GPS accuracy varies under canopy / indoors. Confirm station against marks and survey control. Educational field aid only.</p>
    </div>
  `;

  const drop = el.querySelector('#sl-drop');
  const fileInput = el.querySelector('#sl-file');
  const openPicker = () => fileInput.click();
  // Use a <div> (not <label>) + one programmatic click — nested <label> + click()
  // double-fires on iOS Safari and the picker often never opens.
  el.querySelector('#sl-upload-btn').addEventListener('click', openPicker);
  drop.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    openPicker();
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) handleFile(f);
  });
  ;['dragenter', 'dragover'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('drag');
    });
  });
  ;['dragleave', 'drop'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
    });
  });
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  el.querySelector('#sl-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filterMode = btn.dataset.filter;
    el.querySelectorAll('#sl-filter button').forEach((b) => b.classList.toggle('active', b === btn));
    updateReadout();
  });

  el.querySelector('#sl-use').addEventListener('click', () => {
    const sta = el.querySelector('#sl-use').dataset.station;
    if (!sta) return;
    saveSettings({ currentStation: sta });
    el.querySelector('#sl-saved').textContent = `Current: ${sta}`;
    setStatus(`Saved station ${sta} for Photo Stamp / Daily Report.`);
  });

  el.querySelector('#sl-refresh').addEventListener('click', () => {
    startWatch();
    setStatus('Refreshing GPS…');
  });

  idbGet().then((stored) => {
    if (stored?.stations) {
      mapData = stored;
      renderMapMeta();
      updateReadout();
      setStatus(
        `Loaded ${stored.stations.length} stations + ${stored.features?.length || 0} features from this device.`
      );
    } else {
      renderMapMeta();
    }
    startWatch();
  });
}
