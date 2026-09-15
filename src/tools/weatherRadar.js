/**
 * Weather Radar — RainViewer radar + Blitzortung nearest lightning
 * Educational field aid only. Not a substitute for NWS warnings / employer weather policy.
 */
import { getGps, fmtGps } from '../store.js';

const RV_META = 'https://api.rainviewer.com/public/weather-maps.json';
const WS_HOSTS = ['ws1', 'ws7', 'ws8'];
const STRIKE_TTL_MS = 30 * 60 * 1000;
const MAX_STRIKES = 4000;
const EARTH_M = 6371000;

let root = null;
let gps = null;
let frames = []; // { time, path, host }
let frameIndex = 0;
let framesReady = false;
let playTimer = null;
let metaTimer = null;
let ws = null;
let wsRetry = null;
let ageTimer = null;
let strikes = []; // { lat, lon, timeMs }
let nearest = null;

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
  if (mi < 10) return `${mi.toFixed(1)} mi (${Math.round(m / 1000)} km)`;
  return `${Math.round(mi)} mi (${Math.round(m / 1000)} km)`;
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

function setStatus(msg, isErr = false) {
  const el = root?.querySelector('#wx-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isErr);
}

function getZoom() {
  return Number(root?.querySelector('#wx-zoom')?.value) || 6;
}

function getCenter() {
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lon)) return gps;
  const lat = Number(root?.querySelector('#wx-lat')?.value);
  const lon = Number(root?.querySelector('#wx-lon')?.value);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, accuracy: null };
  return null;
}

function radarUrl(frame, center, zoom) {
  if (!frame || !center) return '';
  const lat = center.lat.toFixed(4);
  const lon = center.lon.toFixed(4);
  // Free-tier friendly: 256px, color 2, no smooth/snow flags
  return `${frame.host}${frame.path}/256/${zoom}/${lat}/${lon}/2/0_0.png`;
}

function updateRadarImage() {
  const img = root?.querySelector('#wx-radar');
  const label = root?.querySelector('#wx-frame-label');
  const slider = root?.querySelector('#wx-frame');
  const center = getCenter();
  if (!img || !frames.length || !center) {
    if (img) img.removeAttribute('src');
    if (label) label.textContent = 'No radar frame';
    return;
  }
  frameIndex = Math.max(0, Math.min(frameIndex, frames.length - 1));
  const frame = frames[frameIndex];
  img.src = radarUrl(frame, center, getZoom());
  img.alt = `Radar ${fmtFrameTime(frame.time)}`;
  if (label) {
    label.textContent = `${fmtFrameTime(frame.time)} · frame ${frameIndex + 1}/${frames.length}`;
  }
  if (slider) {
    slider.max = String(frames.length - 1);
    slider.value = String(frameIndex);
  }
}

async function fetchRadarMeta() {
  try {
    const res = await fetch(RV_META, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Radar API HTTP ${res.status}`);
    const data = await res.json();
    const host = data.host || 'https://tilecache.rainviewer.com';
    const past = Array.isArray(data.radar?.past) ? data.radar.past : [];
    const nowcast = Array.isArray(data.radar?.nowcast) ? data.radar.nowcast : [];
    frames = [...past, ...nowcast]
      .filter((f) => f && f.path && f.time)
      .map((f) => ({ time: f.time, path: f.path, host }));
    if (!frames.length) throw new Error('No radar frames available.');
    if (!framesReady) {
      frameIndex = Math.max(0, past.length - 1);
      framesReady = true;
    } else if (frameIndex >= frames.length) {
      frameIndex = frames.length - 1;
    }
    updateRadarImage();
    setStatus(`Radar updated · ${frames.length} frames (RainViewer)`);
  } catch (err) {
    console.warn(err);
    setStatus(err.message || 'Radar fetch failed', true);
  }
}

function stopPlay() {
  if (playTimer != null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  const btn = root?.querySelector('#wx-play');
  if (btn) {
    btn.textContent = 'Play loop';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function startPlay() {
  stopPlay();
  if (frames.length < 2) return;
  const btn = root?.querySelector('#wx-play');
  if (btn) {
    btn.textContent = 'Pause';
    btn.setAttribute('aria-pressed', 'true');
  }
  playTimer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length;
    updateRadarImage();
  }, 700);
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
  if (live) {
    live.textContent = ws && ws.readyState === WebSocket.OPEN
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
            <strong>${escapeHtml(fmtDist(s.distM))}</strong>
            <span class="meta">${escapeHtml(s.compass)} · ${escapeHtml(fmtAge(Date.now() - s.timeMs))} · ${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}</span>
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
    // Blitzortung often sends nanoseconds since epoch
    timeMs = raw.time > 1e15 ? Math.floor(raw.time / 1e6) : raw.time > 1e12 ? Math.floor(raw.time / 1e3) : raw.time * 1000;
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
  ws.onerror = () => {
    /* onclose will retry */
  };
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
  if (gps) el.textContent = `${fmtGps(gps)}`;
  else el.textContent = 'GPS: not set — use Locate or enter lat/lon';
}

async function locate() {
  setStatus('Getting GPS…');
  const g = await getGps();
  if (!g) {
    setStatus('GPS unavailable — enter lat/lon manually or allow location.', true);
    return;
  }
  gps = g;
  const latIn = root.querySelector('#wx-lat');
  const lonIn = root.querySelector('#wx-lon');
  if (latIn) latIn.value = g.lat.toFixed(5);
  if (lonIn) lonIn.value = g.lon.toFixed(5);
  updateGpsLabel();
  updateRadarImage();
  recomputeNearest();
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
  updateRadarImage();
  recomputeNearest();
  setStatus('Manual location applied.');
}

function openExternalMaps() {
  const c = getCenter();
  if (!c) {
    setStatus('Set a location first.', true);
    return;
  }
  const lm = `https://www.lightningmaps.org/#m=oss;t=3;s=0;o=0;b=;y=${c.lat};x=${c.lon};z=7;d=2;dl=2;dc=0;`;
  const rv = `https://www.rainviewer.com/map.html?loc=${c.lat},${c.lon},7`;
  window.open(lm, '_blank', 'noopener,noreferrer');
  // also stash rainviewer as secondary — open lightning maps primarily
  root.querySelector('#wx-ext-rv').href = rv;
}

export function leaveWeather() {
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
}

/** Resume live feeds when returning to this view (mount is one-shot). */
export function enterWeather() {
  if (!root) return;
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    connectWs();
  }
  if (!metaTimer) metaTimer = setInterval(fetchRadarMeta, 5 * 60 * 1000);
  if (!ageTimer) {
    ageTimer = setInterval(() => {
      if (root) recomputeNearest();
    }, 15000);
  }
  fetchRadarMeta();
  updateRadarImage();
  recomputeNearest();
}

export function mountWeather(el) {
  root = el;
  strikes = [];
  nearest = null;
  frames = [];
  frameIndex = 0;
  framesReady = false;

  el.innerHTML = `
    <p class="muted">Live <strong>RainViewer</strong> radar centered on your location, plus nearest <strong>Blitzortung</strong> lightning. Field awareness aid only — obey NWS warnings and your employer’s weather stop-work rules.</p>

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
      <h3>Radar (RainViewer)</h3>
      <div class="wx-map-wrap">
        <img id="wx-radar" class="wx-radar-img" alt="Weather radar" />
        <div class="wx-crosshair" aria-hidden="true"></div>
      </div>
      <p class="muted" id="wx-frame-label">Loading radar…</p>
      <div class="slider-row">
        <label for="wx-frame">Frame</label>
        <input id="wx-frame" type="range" min="0" max="0" value="0" />
      </div>
      <div class="slider-row">
        <label for="wx-zoom">Zoom</label>
        <input id="wx-zoom" type="range" min="3" max="7" value="6" />
        <span class="muted" id="wx-zoom-val">6</span>
      </div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="wx-play" aria-pressed="false">Play loop</button>
        <button type="button" class="secondary-btn" id="wx-refresh">Refresh</button>
      </div>
      <p class="muted">Data: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a> · max zoom 7 on free tiles</p>
    </div>

    <div class="card">
      <h3>Nearest lightning (Blitzortung)</h3>
      <p class="muted" id="wx-strike-live">Lightning: connecting…</p>
      <div class="result-box" id="wx-nearest"><div class="big">—</div></div>
      <div id="wx-nearby" class="sl-section"></div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="wx-open-lm">Open LightningMaps</button>
        <a class="secondary-btn dr-link-btn" id="wx-ext-rv" href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer map</a>
      </div>
      <p class="disclaimer muted">Blitzortung is a volunteer network — coverage and latency vary. The 30/30 rule: if thunder follows lightning by ≤30s (~6 mi), seek shelter; wait 30 minutes after the last thunder. Not a warning service.</p>
    </div>

    <p class="muted" id="wx-status"></p>
  `;

  el.querySelector('#wx-locate').addEventListener('click', () => locate());
  el.querySelector('#wx-apply').addEventListener('click', () => applyManualCenter());
  el.querySelector('#wx-refresh').addEventListener('click', () => {
    fetchRadarMeta();
    recomputeNearest();
  });
  el.querySelector('#wx-play').addEventListener('click', () => {
    if (playTimer) stopPlay();
    else startPlay();
  });
  el.querySelector('#wx-frame').addEventListener('input', (e) => {
    stopPlay();
    frameIndex = Number(e.target.value) || 0;
    updateRadarImage();
  });
  el.querySelector('#wx-zoom').addEventListener('input', (e) => {
    el.querySelector('#wx-zoom-val').textContent = e.target.value;
    updateRadarImage();
  });
  el.querySelector('#wx-open-lm').addEventListener('click', () => openExternalMaps());

  ['#wx-lat', '#wx-lon'].forEach((sel) => {
    el.querySelector(sel).addEventListener('change', () => applyManualCenter());
  });

  locate().then(() => fetchRadarMeta());
  connectWs();
  metaTimer = setInterval(fetchRadarMeta, 5 * 60 * 1000);
  ageTimer = setInterval(() => {
    if (root) recomputeNearest();
  }, 15000);
}
