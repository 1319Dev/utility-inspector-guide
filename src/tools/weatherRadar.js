/**
 * Weather Radar — WeatherBug-style Leaflet map
 * US: IEM NEXRAD mosaic (NOAA/NWS) loop; elsewhere: RainViewer tiles.
 * Lightning: Blitzortung community websocket.
 * Educational field aid only. Not a substitute for NWS warnings / employer weather policy.
 */
import { getGps, fmtGps } from '../store.js';

const RV_META = 'https://api.rainviewer.com/public/weather-maps.json';
const IEM_TMS = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
const IEM_WWA = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/us/wwa.cgi';
const CARTO_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const WS_HOSTS = ['ws1', 'ws7', 'ws8'];
const STRIKE_TTL_MS = 30 * 60 * 1000;
const MAX_STRIKES = 4000;
const MAX_MAP_STRIKES = 280;
const EARTH_M = 6371000;
const CONUS = { latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 };
const FALLBACK = { lat: 30.27, lon: -97.74, accuracy: null };
const SPEEDS = { '0.5': 900, '1': 450, '2': 220 };

let L = null;
let root = null;
let gps = null;
let map = null;
let baseLayer = null;
let wwaLayer = null;
let youMarker = null;
let youPulse = null;
let ring10 = null;
let ring30 = null;
let strikeLayer = null;
const strikeMarkers = new Map();

let frames = []; // { time, urlTemplate, source, maxNativeZoom }
let frameIndex = 0;
let radarLayers = []; // leaflet tile layers aligned with frames
let playTimer = null;
let metaTimer = null;
let ws = null;
let wsRetry = null;
let ageTimer = null;
let resizeObs = null;
let strikes = [];
let nearest = null;
let rvHost = 'https://tilecache.rainviewer.com';
let sourceMode = 'auto'; // auto | iem | rv
let activeSource = 'iem';
let opacity = 0.7;
let speed = 1;
let showLightning = true;
let showWarnings = true;
let mapReady = false;
let session = 0;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  const mi = m / 1609.344;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

function fmtAge(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function fmtFrameTime(unix) {
  try {
    return new Date(unix * 1000).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Blitzortung LZW-style decode used by map.blitzortung.org clients */
function decodeBlitz(b) {
  let a;
  const e = {};
  const d = String(b).split('');
  let c = d[0];
  let f = c;
  const g = [c];
  const h = 256;
  let o = h;
  for (let i = 1; i < d.length; i++) {
    a = d[i].charCodeAt(0);
    a = h > a ? d[i] : e[a] ? e[a] : f + c;
    g.push(a);
    c = a.charAt(0);
    e[o] = f + c;
    o++;
    f = a;
  }
  return g.join('');
}

function isConus(c) {
  if (!c) return false;
  return (
    c.lat >= CONUS.latMin &&
    c.lat <= CONUS.latMax &&
    c.lon >= CONUS.lonMin &&
    c.lon <= CONUS.lonMax
  );
}

function getCenter() {
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lon)) return gps;
  const lat = Number(root?.querySelector('#wx-lat')?.value);
  const lon = Number(root?.querySelector('#wx-lon')?.value);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, accuracy: null };
  return null;
}

function resolveSource(center) {
  if (sourceMode === 'iem') return 'iem';
  if (sourceMode === 'rv') return 'rv';
  return isConus(center || FALLBACK) ? 'iem' : 'rv';
}

function setStatus(msg, isErr = false) {
  const el = root?.querySelector('#wx-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isErr);
}

function sourceLabel() {
  if (activeSource === 'iem') return 'NEXRAD';
  return 'Global';
}

async function loadLeaflet() {
  if (L) return L;
  const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  L = mod.default;
  return L;
}

function iemLoopFrames() {
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (let m = 50; m >= 5; m -= 5) {
    const tag = String(m).padStart(2, '0');
    out.push({
      time: now - m * 60,
      source: 'iem',
      maxNativeZoom: 8,
      urlTemplate: `${IEM_TMS}/nexrad-n0q-900913-m${tag}m/{z}/{x}/{y}.png`,
    });
  }
  out.push({
    time: now,
    source: 'iem',
    maxNativeZoom: 8,
    urlTemplate: `${IEM_TMS}/nexrad-n0q-900913/{z}/{x}/{y}.png`,
  });
  return out;
}

function rvLoopFrames(meta) {
  const host = meta.host || rvHost;
  rvHost = host;
  const past = Array.isArray(meta.radar?.past) ? meta.radar.past : [];
  return past
    .filter((f) => f && f.path && f.time)
    .map((f) => ({
      time: f.time,
      source: 'rv',
      maxNativeZoom: 7,
      urlTemplate: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
    }));
}

function clearRadarLayers() {
  radarLayers.forEach((ly) => {
    try {
      map?.removeLayer(ly);
    } catch {
      /* ignore */
    }
  });
  radarLayers = [];
}

function makeRadarLayer(frame) {
  return L.tileLayer(frame.urlTemplate, {
    opacity: 0,
    tileSize: 256,
    maxNativeZoom: frame.maxNativeZoom || 8,
    maxZoom: 12,
    minZoom: 3,
    pane: 'overlayPane',
    className: 'wx-radar-tiles',
    attribution:
      frame.source === 'iem'
        ? 'Radar NOAA/NWS via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">IEM</a>'
        : '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
  });
}

function showFrame(i, { holdPlay = false } = {}) {
  if (!map || !frames.length) return;
  frameIndex = Math.max(0, Math.min(i, frames.length - 1));
  if (!radarLayers[frameIndex]) {
    radarLayers[frameIndex] = makeRadarLayer(frames[frameIndex]);
    radarLayers[frameIndex].addTo(map);
  }
  const next = (frameIndex + 1) % frames.length;
  if (!radarLayers[next]) {
    radarLayers[next] = makeRadarLayer(frames[next]);
    radarLayers[next].addTo(map);
  }
  radarLayers.forEach((ly, idx) => {
    if (!ly) return;
    ly.setOpacity(idx === frameIndex ? opacity : 0);
  });
  const label = root?.querySelector('#wx-frame-label');
  const slider = root?.querySelector('#wx-frame');
  const chip = root?.querySelector('#wx-source-chip');
  const frame = frames[frameIndex];
  if (label) {
    const isNow = frameIndex === frames.length - 1;
    label.textContent = `${fmtFrameTime(frame.time)}${isNow && frame.source === 'iem' ? ' · live' : ''}`;
  }
  if (slider) {
    slider.max = String(Math.max(0, frames.length - 1));
    slider.value = String(frameIndex);
  }
  if (chip) chip.textContent = sourceLabel();
  if (!holdPlay && playTimer) {
    /* next tick handled by interval */
  }
}

function stopPlay() {
  if (playTimer != null) {
    clearInterval(playTimer);
    clearTimeout(playTimer);
    playTimer = null;
  }
  const btn = root?.querySelector('#wx-play');
  if (btn) {
    btn.textContent = 'Play';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function startPlay() {
  stopPlay();
  if (frames.length < 2 || !map) return;
  const btn = root?.querySelector('#wx-play');
  if (btn) {
    btn.textContent = 'Pause';
    btn.setAttribute('aria-pressed', 'true');
  }
  const delay = SPEEDS[String(speed)] || 450;
  const tick = () => {
    if (!map || !frames.length) return;
    // Brief hold on the newest frame before looping (WeatherBug-style)
    if (frameIndex === frames.length - 1) {
      clearInterval(playTimer);
      playTimer = setTimeout(() => {
        if (!root || !map) return;
        frameIndex = 0;
        showFrame(0);
        startPlay();
      }, delay * 2);
      return;
    }
    frameIndex += 1;
    showFrame(frameIndex);
  };
  playTimer = setInterval(tick, delay);
}

function applyOpacity() {
  const ly = radarLayers[frameIndex];
  if (ly) ly.setOpacity(opacity);
}

function rebuildRadar(keepPlaying = true) {
  if (!map || !L) return;
  const wasPlaying = keepPlaying;
  stopPlay();
  clearRadarLayers();
  const center = getCenter() || FALLBACK;
  activeSource = resolveSource(center);
  if (activeSource === 'iem') {
    frames = iemLoopFrames();
    frameIndex = frames.length - 1;
    showFrame(frameIndex);
    setStatus('NEXRAD mosaic · NOAA/NWS via Iowa State Mesonet');
    if (wasPlaying) startPlay();
  } else {
    fetchRadarMeta().then(() => {
      if (wasPlaying) startPlay();
    });
  }
  const chip = root?.querySelector('#wx-source-chip');
  if (chip) chip.textContent = sourceLabel();
}

async function fetchRadarMeta() {
  try {
    const res = await fetch(RV_META, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Radar API HTTP ${res.status}`);
    const data = await res.json();
    if (activeSource !== 'rv' && resolveSource(getCenter() || FALLBACK) !== 'rv') {
      return;
    }
    const next = rvLoopFrames(data);
    if (!next.length) throw new Error('No RainViewer frames.');
    clearRadarLayers();
    frames = next;
    frameIndex = frames.length - 1;
    showFrame(frameIndex);
    setStatus(`Global radar · ${frames.length} frames (RainViewer)`);
  } catch (err) {
    console.warn(err);
    if (activeSource === 'rv') {
      setStatus(err.message || 'Radar fetch failed', true);
    }
  }
}

function youIcon() {
  return L.divIcon({
    className: 'wx-you-wrap',
    html: '<span class="wx-you-pulse"></span><span class="wx-you-dot"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function updateYouMarker() {
  if (!map || !L) return;
  const c = getCenter();
  if (!c) return;
  const latlng = [c.lat, c.lon];
  if (youMarker) youMarker.setLatLng(latlng);
  else {
    youMarker = L.marker(latlng, { icon: youIcon(), zIndexOffset: 800, keyboard: false });
    youMarker.addTo(map);
  }
  const ringOpts = { fill: false, weight: 1.5, dashArray: '5 6', interactive: false };
  if (ring10) ring10.setLatLng(latlng);
  else {
    ring10 = L.circle(latlng, { ...ringOpts, radius: 16093.44, color: '#f87171', opacity: 0.85 });
    ring10.addTo(map);
  }
  if (ring30) ring30.setLatLng(latlng);
  else {
    ring30 = L.circle(latlng, { ...ringOpts, radius: 48280.32, color: '#fbbf24', opacity: 0.7 });
    ring30.addTo(map);
  }
}

function recenter(zoom) {
  const c = getCenter() || FALLBACK;
  if (!map) return;
  const z = zoom ?? Math.max(map.getZoom(), activeSource === 'iem' ? 8 : 6);
  map.setView([c.lat, c.lon], z, { animate: true });
  updateYouMarker();
}

function toggleWarnings() {
  if (!map || !L) return;
  if (!showWarnings) {
    if (wwaLayer) {
      map.removeLayer(wwaLayer);
      wwaLayer = null;
    }
    return;
  }
  if (wwaLayer) return;
  wwaLayer = L.tileLayer.wms(IEM_WWA, {
    layers: 'warnings_c',
    format: 'image/png',
    transparent: true,
    opacity: 0.55,
    attribution: 'NWS warnings via IEM',
  });
  wwaLayer.addTo(map);
}

function strikeKey(s) {
  return `${s.lat.toFixed(4)},${s.lon.toFixed(4)},${s.timeMs}`;
}

function syncStrikeMarkers() {
  if (!map || !L || !strikeLayer) return;
  if (!showLightning) {
    strikeLayer.clearLayers();
    strikeMarkers.clear();
    return;
  }
  pruneStrikes();
  const bounds = map.getBounds().pad(0.25);
  const center = getCenter() || {
    lat: map.getCenter().lat,
    lon: map.getCenter().lng,
  };
  const ranked = [];
  for (const s of strikes) {
    if (!bounds.contains([s.lat, s.lon])) continue;
    ranked.push({ s, dist: haversineM(center, s) });
  }
  ranked.sort((a, b) => a.dist - b.dist);
  const keepList = ranked.slice(0, MAX_MAP_STRIKES);
  const keep = new Set();
  const now = Date.now();
  for (const { s } of keepList) {
    const key = strikeKey(s);
    keep.add(key);
    if (strikeMarkers.has(key)) continue;
    const age = now - s.timeMs;
    const mk = L.circleMarker([s.lat, s.lon], {
      radius: age < 120000 ? 7 : 4,
      color: age < 120000 ? '#fff7ed' : '#facc15',
      fillColor: age < 300000 ? '#fde047' : '#eab308',
      fillOpacity: age < 10 * 60 * 1000 ? 0.95 : 0.4,
      weight: 1,
      interactive: false,
    });
    mk.addTo(strikeLayer);
    strikeMarkers.set(key, mk);
  }
  for (const [key, mk] of strikeMarkers) {
    if (!keep.has(key)) {
      strikeLayer.removeLayer(mk);
      strikeMarkers.delete(key);
    }
  }
}

function pruneStrikes() {
  const cutoff = Date.now() - STRIKE_TTL_MS;
  strikes = strikes.filter((s) => s.timeMs >= cutoff);
  if (strikes.length > MAX_STRIKES) {
    strikes = strikes.slice(strikes.length - MAX_STRIKES);
  }
}

function recomputeNearest() {
  const center = getCenter();
  const box = root?.querySelector('#wx-nearest');
  const list = root?.querySelector('#wx-nearby');
  const live = root?.querySelector('#wx-strike-live');
  if (!box) return;

  pruneStrikes();
  syncStrikeMarkers();
  if (live) {
    live.textContent =
      ws && ws.readyState === WebSocket.OPEN
        ? `Live · ${strikes.length} strikes (30 min)`
        : 'Lightning: connecting…';
  }

  if (!center) {
    nearest = null;
    box.className = 'result-box';
    box.innerHTML = `<div class="big">—</div><div class="muted">Need GPS or lat/lon</div>`;
    if (list) list.innerHTML = '';
    return;
  }

  if (!strikes.length) {
    nearest = null;
    const connected = ws && ws.readyState === WebSocket.OPEN;
    box.className = 'result-box';
    box.innerHTML = connected
      ? `<div class="muted">Nearest lightning (30 min)</div>
         <div class="big">Listening…</div>
         <div class="muted">Stream connected — waiting for strikes (or none nearby yet).</div>`
      : `<div class="muted">Nearest lightning (30 min)</div>
         <div class="big">—</div>
         <div class="muted">Connecting to Blitzortung…</div>`;
    if (list) list.innerHTML = '';
    return;
  }

  const ranked = strikes
    .map((s) => {
      const distM = haversineM(center, s);
      const brg = bearingDeg(center, s);
      return { ...s, distM, bearing: brg, compass: compass(brg) };
    })
    .sort((a, b) => a.distM - b.distM);

  nearest = ranked[0];
  const mi = nearest.distM / 1609.344;
  const age = Date.now() - nearest.timeMs;
  let state = 'pass';
  let headline = 'Clear';
  let advice = 'No close strikes in the last 30 minutes of stream data.';
  if (mi <= 10) {
    state = 'fail';
    headline = 'CLOSE';
    advice = 'Lightning within ~10 mi — stop outdoor work; seek substantial shelter. Follow 30/30 rule.';
  } else if (mi <= 30) {
    state = 'warn';
    headline = 'NEARBY';
    advice = 'Storm within ~30 mi — monitor closely; ready to pause outdoor tasks.';
  } else if (mi <= 50) {
    state = 'idle';
    headline = 'Regional';
    advice = 'Activity beyond 30 mi — stay aware of sky conditions and NWS alerts.';
  }

  box.className = `result-box ${state === 'warn' || state === 'idle' ? '' : state}`.trim();
  if (state === 'warn') box.classList.add('wx-warn');
  if (state === 'idle') box.classList.add('wx-watch');

  box.innerHTML = `
    <div class="muted">Nearest lightning · ${escapeHtml(headline)}</div>
    <div class="big">${escapeHtml(fmtDist(nearest.distM))}</div>
    <div class="wx-dist">${escapeHtml(nearest.compass)} (${Math.round(nearest.bearing)}°) · ${escapeHtml(fmtAge(age))}</div>
    <div class="muted">${escapeHtml(advice)}</div>`;

  if (list) {
    const top = ranked.slice(0, 5);
    list.innerHTML = `
      <h3>Closest strikes</h3>
      <div class="list">
        ${top
          .map(
            (s) => `
          <div class="list-item">
            <strong>${escapeHtml(fmtDist(s.distM))} ${escapeHtml(s.compass)}</strong>
            <span class="meta">${escapeHtml(fmtAge(Date.now() - s.timeMs))} · ${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}</span>
          </div>`
          )
          .join('')}
      </div>`;
  }
}

function ingestStrike(raw) {
  if (!raw || typeof raw !== 'object') return;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  let timeMs;
  if (typeof raw.time === 'number') {
    timeMs =
      raw.time > 1e15
        ? Math.floor(raw.time / 1e6)
        : raw.time > 1e12
          ? Math.floor(raw.time / 1e3)
          : raw.time * 1000;
  } else {
    timeMs = Date.now();
  }
  if (Date.now() - timeMs > STRIKE_TTL_MS) return;
  strikes.push({ lat, lon, timeMs });
  pruneStrikes();
  recomputeNearest();
}

function disconnectWs() {
  if (wsRetry) {
    clearTimeout(wsRetry);
    wsRetry = null;
  }
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {
      /* ignore */
    }
  }
  ws = null;
}

function connectWs() {
  disconnectWs();
  const host = WS_HOSTS[Math.floor(Math.random() * WS_HOSTS.length)];
  const url = `wss://${host}.blitzortung.org`;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.warn(err);
    wsRetry = setTimeout(connectWs, 5000);
    return;
  }
  ws.onopen = () => {
    try {
      ws.send(JSON.stringify({ a: 111 }));
    } catch {
      /* ignore */
    }
    const live = root?.querySelector('#wx-strike-live');
    if (live) live.textContent = `Live · ${strikes.length} strikes (30 min)`;
  };
  ws.onmessage = (ev) => {
    try {
      const text = typeof ev.data === 'string' ? decodeBlitz(ev.data) : '';
      if (!text) return;
      const data = JSON.parse(text);
      ingestStrike(data);
    } catch {
      /* bad frame */
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    ws = null;
    const live = root?.querySelector('#wx-strike-live');
    if (live) live.textContent = 'Lightning: reconnecting…';
    wsRetry = setTimeout(connectWs, 4000);
  };
}

function updateGpsLabel() {
  const el = root?.querySelector('#wx-gps');
  if (!el) return;
  if (gps) el.textContent = fmtGps(gps);
  else el.textContent = 'GPS: not set — use Locate or enter lat/lon';
}

async function fetchNwsBanner(center) {
  const banner = root?.querySelector('#wx-nws');
  if (!banner || !center) return;
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${center.lat.toFixed(4)},${center.lon.toFixed(4)}`,
      {
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': 'utility-inspector-guide (educational field PWA)',
        },
      }
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const feats = Array.isArray(data.features) ? data.features : [];
    const severe = feats
      .map((f) => f?.properties)
      .filter((p) => p && /warning|watch/i.test(p.event || ''))
      .slice(0, 3);
    if (!severe.length) {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }
    banner.hidden = false;
    banner.innerHTML = severe
      .map((p) => `<strong>${escapeHtml(p.event)}</strong> — ${escapeHtml((p.headline || p.event).slice(0, 140))}`)
      .join('<br>');
  } catch {
    /* optional */
  }
}

async function locate() {
  setStatus('Getting GPS…');
  const g = await getGps();
  if (!g) {
    setStatus('GPS unavailable — enter lat/lon or allow location.', true);
    return;
  }
  gps = g;
  const latIn = root.querySelector('#wx-lat');
  const lonIn = root.querySelector('#wx-lon');
  if (latIn) latIn.value = g.lat.toFixed(5);
  if (lonIn) lonIn.value = g.lon.toFixed(5);
  updateGpsLabel();
  updateYouMarker();
  recenter(activeSource === 'iem' ? 8 : 6);
  rebuildRadar(true);
  recomputeNearest();
  fetchNwsBanner(g);
  setStatus('Location updated.');
}

function applyManualCenter() {
  const lat = Number(root.querySelector('#wx-lat').value);
  const lon = Number(root.querySelector('#wx-lon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus('Enter valid latitude and longitude.', true);
    return;
  }
  gps = { lat, lon, accuracy: null };
  updateGpsLabel();
  updateYouMarker();
  recenter();
  rebuildRadar(true);
  recomputeNearest();
  fetchNwsBanner(gps);
  setStatus('Manual location applied.');
}

function cycleSource() {
  sourceMode = sourceMode === 'auto' ? 'iem' : sourceMode === 'iem' ? 'rv' : 'auto';
  const modeEl = root?.querySelector('#wx-source-mode');
  if (modeEl) {
    modeEl.textContent = sourceMode === 'auto' ? 'Auto' : sourceMode === 'iem' ? 'NEXRAD' : 'Global';
  }
  rebuildRadar(true);
}

function destroyMap() {
  stopPlay();
  if (resizeObs) {
    try {
      resizeObs.disconnect();
    } catch {
      /* ignore */
    }
    resizeObs = null;
  }
  clearRadarLayers();
  if (map) {
    try {
      map.off();
      map.remove();
    } catch {
      /* ignore */
    }
  }
  map = null;
  baseLayer = null;
  wwaLayer = null;
  youMarker = null;
  youPulse = null;
  ring10 = null;
  ring30 = null;
  strikeLayer = null;
  strikeMarkers.clear();
  mapReady = false;
}

async function initMap() {
  if (!root) return;
  const mySession = session;
  const el = root.querySelector('#wx-map');
  if (!el) return;
  await loadLeaflet();
  if (mySession !== session || !root) return;
  if (map) destroyMap();
  const c = getCenter() || FALLBACK;
  activeSource = resolveSource(c);
  map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
  }).setView([c.lat, c.lon], activeSource === 'iem' ? 8 : 6);
  L.control.zoom({ position: 'topright' }).addTo(map);

  baseLayer = L.tileLayer(CARTO_DARK, {
    maxZoom: 12,
    minZoom: 3,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  strikeLayer = L.layerGroup().addTo(map);
  updateYouMarker();
  toggleWarnings();
  map.on('moveend', () => syncStrikeMarkers());
  mapReady = true;

  const stage = root.querySelector('.wx-stage');
  if (stage && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => {
      map?.invalidateSize();
    });
    resizeObs.observe(stage);
  }

  requestAnimationFrame(() => {
    map?.invalidateSize();
    rebuildRadar(true);
  });
}

function bindUi(el) {
  el.querySelector('#wx-locate').addEventListener('click', () => locate());
  el.querySelector('#wx-apply').addEventListener('click', () => applyManualCenter());
  el.querySelector('#wx-play').addEventListener('click', () => {
    if (playTimer) stopPlay();
    else startPlay();
  });
  el.querySelector('#wx-frame').addEventListener('input', (e) => {
    stopPlay();
    showFrame(Number(e.target.value) || 0);
  });
  el.querySelector('#wx-opacity').addEventListener('input', (e) => {
    opacity = Number(e.target.value) / 100;
    applyOpacity();
  });
  el.querySelectorAll('[data-wx-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      speed = Number(btn.dataset.wxSpeed) || 1;
      el.querySelectorAll('[data-wx-speed]').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      if (playTimer) startPlay();
    });
  });
  el.querySelector('#wx-recenter').addEventListener('click', () => recenter());
  el.querySelector('#wx-tog-ltn').addEventListener('click', () => {
    showLightning = !showLightning;
    el.querySelector('#wx-tog-ltn').setAttribute('aria-pressed', String(showLightning));
    syncStrikeMarkers();
  });
  el.querySelector('#wx-tog-wwa').addEventListener('click', () => {
    showWarnings = !showWarnings;
    el.querySelector('#wx-tog-wwa').setAttribute('aria-pressed', String(showWarnings));
    if (!showWarnings && wwaLayer && map) {
      map.removeLayer(wwaLayer);
      wwaLayer = null;
    } else toggleWarnings();
  });
  el.querySelector('#wx-source-mode').addEventListener('click', () => cycleSource());
  ['#wx-lat', '#wx-lon'].forEach((sel) => {
    el.querySelector(sel).addEventListener('change', () => applyManualCenter());
  });
}

export function leaveWeather() {
  session += 1;
  stopPlay();
  disconnectWs();
  if (metaTimer) {
    clearInterval(metaTimer);
    metaTimer = null;
  }
  if (ageTimer) {
    clearInterval(ageTimer);
    ageTimer = null;
  }
  destroyMap();
}

export function enterWeather() {
  if (!root) return;
  session += 1;
  initMap().then(() => {
    map?.invalidateSize();
    setTimeout(() => map?.invalidateSize(), 250);
  });
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    connectWs();
  }
  if (!metaTimer) {
    metaTimer = setInterval(() => {
      if (!root || !map) return;
      const playing = !!playTimer;
      if (resolveSource(getCenter() || FALLBACK) === 'iem') rebuildRadar(playing || true);
      else fetchRadarMeta().then(() => {
        if (playing || true) startPlay();
      });
    }, 5 * 60 * 1000);
  }
  if (!ageTimer) {
    ageTimer = setInterval(() => {
      if (root) recomputeNearest();
    }, 15000);
  }
  recomputeNearest();
  const c = getCenter();
  if (c) fetchNwsBanner(c);
}

export function mountWeather(el) {
  root = el;
  strikes = [];
  nearest = null;
  frames = [];
  frameIndex = 0;
  sourceMode = 'auto';
  opacity = 0.7;
  speed = 1;
  showLightning = true;
  showWarnings = true;

  el.innerHTML = `
    <p class="muted">Interactive <strong>NEXRAD</strong> loop (US) with global RainViewer fallback and live <strong>Blitzortung</strong> lightning. Field awareness only — obey NWS warnings and your employer’s stop-work rules.</p>
    <div id="wx-nws" class="wx-nws" hidden></div>

    <div class="wx-stage">
      <div id="wx-map" class="wx-map" role="application" aria-label="Weather radar map"></div>
      <div class="wx-legend" aria-hidden="true">
        <span>Light</span>
        <i></i>
        <span>Heavy</span>
      </div>
      <div class="wx-glass">
        <div class="wx-glass-top">
          <span id="wx-frame-label">Loading radar…</span>
          <button type="button" class="wx-chip-btn" id="wx-source-mode" title="Cycle radar source">Auto</button>
        </div>
        <input id="wx-frame" type="range" min="0" max="0" value="0" aria-label="Radar time" />
        <div class="wx-glass-row">
          <button type="button" class="primary-btn wx-play" id="wx-play" aria-pressed="false">Play</button>
          <div class="segment wx-speed" role="group" aria-label="Playback speed">
            <button type="button" data-wx-speed="0.5">0.5×</button>
            <button type="button" class="active" data-wx-speed="1">1×</button>
            <button type="button" data-wx-speed="2">2×</button>
          </div>
          <button type="button" class="wx-icon-btn" id="wx-tog-ltn" aria-pressed="true" title="Lightning">⚡</button>
          <button type="button" class="wx-icon-btn" id="wx-tog-wwa" aria-pressed="true" title="NWS warnings">⚠</button>
          <button type="button" class="wx-icon-btn" id="wx-recenter" title="Recenter">◎</button>
        </div>
        <div class="wx-glass-row wx-opacity-row">
          <label for="wx-opacity">Opacity</label>
          <input id="wx-opacity" type="range" min="30" max="95" value="70" />
          <span class="muted" id="wx-source-chip">NEXRAD</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Location</h3>
      <p class="muted" id="wx-gps">GPS: …</p>
      <div class="field-row">
        <div class="field"><label>Latitude</label><input id="wx-lat" type="number" inputmode="decimal" step="0.0001" placeholder="30.27" /></div>
        <div class="field"><label>Longitude</label><input id="wx-lon" type="number" inputmode="decimal" step="0.0001" placeholder="-97.74" /></div>
      </div>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="wx-locate">Use GPS</button>
        <button type="button" class="secondary-btn" id="wx-apply">Apply lat/lon</button>
      </div>
    </div>

    <div class="card">
      <h3>Nearest lightning (Blitzortung)</h3>
      <p class="muted" id="wx-strike-live">Lightning: connecting…</p>
      <div class="result-box" id="wx-nearest"><div class="big">—</div></div>
      <div id="wx-nearby" class="sl-section"></div>
      <p class="disclaimer muted">Red ring ≈ 10 mi, yellow ≈ 30 mi. Blitzortung is a volunteer network — coverage and latency vary. 30/30 rule: if thunder follows lightning by ≤30s (~6 mi), seek shelter; wait 30 minutes after the last thunder. Not a warning service.</p>
    </div>

    <p class="muted">Map: CARTO / OSM · US radar: NOAA NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener noreferrer">Iowa State Mesonet</a> · Global: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a> (personal/educational) · Lightning: <a href="https://www.blitzortung.org/" target="_blank" rel="noopener noreferrer">Blitzortung.org</a></p>
    <p class="muted" id="wx-status"></p>
  `;

  bindUi(el);
  locate();
}
