/**
 * Trench Slope Guide — live camera + OSHA Type A/B/C slope overlays
 * Educational / field reference only.
 */

const SOILS = {
  A: {
    id: 'A',
    title: 'Type A',
    hv: 0.75,
    labelHV: '0.75:1 (¾:1)',
    angleDeg: 53,
    color: '#38bdf8',
  },
  B: {
    id: 'B',
    title: 'Type B',
    hv: 1,
    labelHV: '1:1',
    angleDeg: 45,
    color: '#fbbf24',
  },
  C: {
    id: 'C',
    title: 'Type C',
    hv: 1.5,
    labelHV: '1.5:1 (1½:1)',
    angleDeg: 34,
    color: '#fb7185',
  },
};

/** Angle from horizontal for H:V = hv:1 → rise/run = 1/hv → atan(1/hv) */
function angleFromHorizontal(hv) {
  return (Math.atan(1 / hv) * 180) / Math.PI;
}

const video = document.getElementById('camera');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const gate = document.getElementById('camera-gate');
const cameraError = document.getElementById('camera-error');
const btnStart = document.getElementById('btn-start');
const btnInfo = document.getElementById('btn-info');
const infoDialog = document.getElementById('info-dialog');
const scaleSlider = document.getElementById('scale-slider');
const btnReset = document.getElementById('btn-reset');
const btnFlip = document.getElementById('btn-flip');
const btnBoth = document.getElementById('btn-both');
const metaTitle = document.getElementById('meta-title');
const metaDetail = document.getElementById('meta-detail');
const hudHint = document.getElementById('hud-hint');
const btnMeasure = document.getElementById('btn-measure');
const measurePanel = document.getElementById('measure-panel');
const measAngleEl = document.getElementById('meas-angle');
const measAllowedEl = document.getElementById('meas-allowed');
const measDeltaEl = document.getElementById('meas-delta');
const measStatusEl = document.getElementById('meas-status');
const measErrorEl = document.getElementById('meas-error');
const btnFreeze = document.getElementById('btn-freeze');

const state = {
  soil: 'B',
  stream: null,
  // Overlay geometry in CSS pixels relative to canvas
  // Baseline is a horizontal line through the trench toe/crest reference.
  baselineY: 0.62, // fraction of height
  anchorX: 0.5, // fraction — where walls meet the baseline (center for both, or toe for one)
  scale: 1, // multiplies default wall height
  flip: false, // single-wall: left vs right
  bothWalls: true,
  dragging: false,
  dragMode: null, // 'baseline' | 'pan'
  lastPointer: null,
  pinchStartDist: null,
  pinchStartScale: 1,
  running: false,
  dpr: 1,
  // Clinometer / Measure mode
  measuring: false,
  orientationListening: false,
  measuredDeg: null,
  frozen: false,
  frozenDeg: null,
  orientHandler: null,
};

function currentSoil() {
  return SOILS[state.soil];
}

function updateMeta() {
  const s = currentSoil();
  const approx = Math.round(angleFromHorizontal(s.hv));
  metaTitle.textContent = s.title;
  metaDetail.textContent = `H:V ${s.labelHV} · ≈${approx}° from horizontal`;
  updateMeasureUI();
}

function setSoil(id) {
  if (!SOILS[id]) return;
  state.soil = id;
  document.querySelectorAll('.soil-btn').forEach((btn) => {
    const on = btn.dataset.soil === id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateMeta();
  draw();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
  canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  draw();
}

/**
 * Draw translucent slope guide(s).
 * OSHA H:V = horizontal:vertical. For height H, run = H * hv.
 */
function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);

  const soil = currentSoil();
  const hv = soil.hv;
  const color = soil.color;

  const baseY = state.baselineY * h;
  const ax = state.anchorX * w;

  // Wall height in px from scale (default ~42% of view height)
  const wallH = Math.max(40, h * 0.42 * state.scale);
  const run = wallH * hv;

  ctx.save();

  // Dim vignette so guides pop outdoors
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(2,6,23,0.25)');
  g.addColorStop(0.55, 'rgba(2,6,23,0.05)');
  g.addColorStop(1, 'rgba(2,6,23,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const drawWall = (side) => {
    // side: -1 left wall (slope rises up & outward to the left), +1 right
    const sign = side;
    const toeX = ax;
    const crestX = ax + sign * run;
    const crestY = baseY - wallH;

    // Fill: region OUTSIDE the slope (cut soil that should be removed for compliance)
    // Triangle from toe along baseline outward, up to crest, back to toe along slope
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineTo(toeX, baseY);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(color, 0.18);
    ctx.fill();

    // Slope line (the required face)
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glow
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineWidth = 10;
    ctx.strokeStyle = hexAlpha(color, 0.25);
    ctx.stroke();

    // Tick at crest
    ctx.beginPath();
    ctx.arc(crestX, crestY, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
  };

  if (state.bothWalls) {
    drawWall(-1);
    drawWall(1);
  } else {
    drawWall(state.flip ? 1 : -1);
  }

  // Baseline
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(w, baseY);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fde047';
  ctx.stroke();
  ctx.setLineDash([]);

  // Anchor handle
  ctx.beginPath();
  ctx.arc(ax, baseY, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#fde047';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();

  // Label badge
  const approx = Math.round(angleFromHorizontal(hv));
  const label = `${soil.title}  ${soil.labelHV}  ≈${approx}°`;
  ctx.font = '700 15px system-ui, sans-serif';
  const padX = 12;
  const padY = 8;
  const tw = ctx.measureText(label).width;
  const bx = 12;
  const by = 12;
  roundRect(ctx, bx, by, tw + padX * 2, 28 + padY, 10);
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(label, bx + padX, by + 22);

  // Angle callout near slope
  const callX = state.bothWalls || !state.flip ? ax - run * 0.45 : ax + run * 0.45;
  const callY = baseY - wallH * 0.45;
  ctx.font = '700 13px system-ui, sans-serif';
  const ang = `∠ ${approx}°`;
  const aw = ctx.measureText(ang).width;
  roundRect(ctx, callX - aw / 2 - 8, callY - 14, aw + 16, 26, 8);
  ctx.fillStyle = 'rgba(15,23,42,0.75)';
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(ang, callX - aw / 2, callY + 4);

  ctx.restore();
}

function hexAlpha(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

async function startCamera() {
  cameraError.hidden = true;
  cameraError.textContent = '';

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.hidden = false;
    cameraError.textContent =
      'Camera API not available. Open this app over HTTPS on a phone browser.';
    return;
  }

  // Stop previous
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      gate.hidden = true;
      state.running = true;
      resizeCanvas();
      requestAnimationFrame(loop);
      // Hide hint after a bit
      setTimeout(() => {
        if (hudHint) hudHint.style.opacity = '0.35';
      }, 5000);
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  cameraError.hidden = false;
  cameraError.textContent =
    lastErr?.name === 'NotAllowedError'
      ? 'Camera permission denied. Allow camera access and try again.'
      : `Could not start camera: ${lastErr?.message || lastErr}`;
}

function loop() {
  if (!state.running) return;
  draw();
  requestAnimationFrame(loop);
}

function cssPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function onPointerDown(e) {
  e.preventDefault();
  if (hudHint) hudHint.style.opacity = '0';

  if (e.touches && e.touches.length === 2) {
    const rect = canvas.getBoundingClientRect();
    const p1 = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    const p2 = { x: e.touches[1].clientX - rect.left, y: e.touches[1].clientY - rect.top };
    state.pinchStartDist = dist(p1, p2);
    state.pinchStartScale = state.scale;
    state.dragging = false;
    return;
  }

  const p = cssPoint(e);
  const h = canvas.clientHeight;
  const w = canvas.clientWidth;
  const baseY = state.baselineY * h;
  const ax = state.anchorX * w;

  // Near baseline or handle → drag baseline / pan anchor
  if (Math.abs(p.y - baseY) < 36 || dist(p, { x: ax, y: baseY }) < 40) {
    state.dragging = true;
    state.dragMode = dist(p, { x: ax, y: baseY }) < 48 ? 'pan' : 'baseline';
  } else {
    state.dragging = true;
    state.dragMode = 'pan';
  }
  state.lastPointer = p;
}

function onPointerMove(e) {
  e.preventDefault();

  if (e.touches && e.touches.length === 2 && state.pinchStartDist) {
    const rect = canvas.getBoundingClientRect();
    const p1 = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    const p2 = { x: e.touches[1].clientX - rect.left, y: e.touches[1].clientY - rect.top };
    const d = dist(p1, p2);
    const next = state.pinchStartScale * (d / state.pinchStartDist);
    state.scale = clamp(next, 0.4, 2.2);
    scaleSlider.value = String(Math.round(state.scale * 100));
    scaleSlider.setAttribute('aria-valuenow', scaleSlider.value);
    draw();
    return;
  }

  if (!state.dragging || !state.lastPointer) return;
  const p = cssPoint(e);
  const h = canvas.clientHeight;
  const w = canvas.clientWidth;

  if (state.dragMode === 'baseline') {
    state.baselineY = clamp(p.y / h, 0.15, 0.9);
  } else {
    const dx = p.x - state.lastPointer.x;
    const dy = p.y - state.lastPointer.y;
    state.anchorX = clamp(state.anchorX + dx / w, 0.08, 0.92);
    state.baselineY = clamp(state.baselineY + dy / h, 0.15, 0.9);
  }
  state.lastPointer = p;
  draw();
}

function onPointerUp() {
  state.dragging = false;
  state.dragMode = null;
  state.lastPointer = null;
  state.pinchStartDist = null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function resetOverlay() {
  state.baselineY = 0.62;
  state.anchorX = 0.5;
  state.scale = 1;
  scaleSlider.value = '100';
  scaleSlider.setAttribute('aria-valuenow', '100');
  draw();
}


/** Map DeviceOrientation to slope angle from horizontal (0–90°). */
function angleFromOrientation(beta, gamma) {
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  let deg;
  if (landscape) {
    deg = Math.abs(gamma ?? 0);
    // gamma is typically −90…90; if wrapped odd, keep in 0–90
    if (deg > 90) deg = 180 - deg;
  } else {
    // Portrait: beta 0 = flat face-up; ~90 = upright (steep face)
    let b = beta ?? 0;
    // Normalize into a useful tilt from flat
    // When phone face-down-ish, beta can be near ±180
    if (b > 90) b = 180 - b;
    else if (b < -90) b = -180 - b;
    deg = Math.abs(b);
  }
  return clamp(deg, 0, 90);
}

function requiredMaxDeg() {
  return angleFromHorizontal(currentSoil().hv);
}

function setMeasureError(msg) {
  if (!measErrorEl) return;
  if (msg) {
    measErrorEl.hidden = false;
    measErrorEl.textContent = msg;
  } else {
    measErrorEl.hidden = true;
    measErrorEl.textContent = '';
  }
}

function updateMeasureUI() {
  if (!measurePanel || measurePanel.hidden) return;

  const allowed = requiredMaxDeg();
  const allowedRound = Math.round(allowed);
  measAllowedEl.textContent = `${allowedRound}°`;

  const live = state.frozen ? state.frozenDeg : state.measuredDeg;
  if (live == null || Number.isNaN(live)) {
    measAngleEl.textContent = '—°';
    measDeltaEl.textContent = '—';
    measStatusEl.dataset.state = state.frozen ? 'frozen' : 'idle';
    measStatusEl.textContent = state.frozen
      ? 'FROZEN — no reading'
      : 'Waiting for sensor…';
    return;
  }

  const measured = live;
  const measuredRound = Math.round(measured * 10) / 10;
  const delta = measured - allowed;
  const deltaRound = Math.round(delta * 10) / 10;
  const pass = measured <= allowed + 1;

  measAngleEl.textContent = `${measuredRound.toFixed(1)}°`;
  const sign = deltaRound > 0 ? '+' : '';
  measDeltaEl.textContent = `${sign}${deltaRound.toFixed(1)}°`;
  measDeltaEl.style.color = pass ? 'var(--ok)' : 'var(--danger)';

  if (state.frozen) {
    measStatusEl.dataset.state = pass ? 'pass' : 'fail';
    measStatusEl.textContent = pass ? 'PASS (held)' : 'TOO STEEP (held)';
  } else {
    measStatusEl.dataset.state = pass ? 'pass' : 'fail';
    measStatusEl.textContent = pass ? 'PASS' : 'TOO STEEP';
  }
}

function onDeviceOrientation(event) {
  if (!state.measuring || state.frozen) return;
  if (event.beta == null && event.gamma == null) {
    setMeasureError('Motion sensors returned no data on this device.');
    return;
  }
  setMeasureError('');
  state.measuredDeg = angleFromOrientation(event.beta, event.gamma);
  updateMeasureUI();
}

async function requestOrientationPermission() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) {
    throw new Error('Device orientation is not supported in this browser.');
  }
  if (typeof DOE.requestPermission === 'function') {
    const result = await DOE.requestPermission();
    if (result !== 'granted') {
      throw new Error('Motion permission denied. Enable it in Settings to measure.');
    }
  }
}

function startOrientation() {
  if (state.orientationListening) return;
  state.orientHandler = onDeviceOrientation;
  window.addEventListener('deviceorientation', state.orientHandler, true);
  state.orientationListening = true;
}

function stopOrientation() {
  if (!state.orientationListening) return;
  window.removeEventListener('deviceorientation', state.orientHandler, true);
  state.orientationListening = false;
  state.orientHandler = null;
}

async function enableMeasure() {
  setMeasureError('');
  state.frozen = false;
  state.frozenDeg = null;
  state.measuredDeg = null;
  if (btnFreeze) {
    btnFreeze.setAttribute('aria-pressed', 'false');
    btnFreeze.textContent = 'Freeze';
  }

  try {
    await requestOrientationPermission();
  } catch (err) {
    setMeasureError(err.message || String(err));
    measurePanel.hidden = false;
    updateMeasureUI();
    // Still show panel so user sees the error; leave measuring true so they can retry via toggle
    return;
  }

  startOrientation();
  measurePanel.hidden = false;
  updateMeasureUI();

  // Desktop / no-sensor fallback detection after a short wait
  setTimeout(() => {
    if (state.measuring && !state.frozen && state.measuredDeg == null && !measErrorEl?.textContent) {
      setMeasureError(
        'No tilt data yet. Use a phone with motion sensors over HTTPS, or check permissions.'
      );
    }
  }, 2500);
}

function disableMeasure() {
  stopOrientation();
  state.frozen = false;
  state.frozenDeg = null;
  state.measuredDeg = null;
  if (measurePanel) measurePanel.hidden = true;
  if (btnFreeze) {
    btnFreeze.setAttribute('aria-pressed', 'false');
    btnFreeze.textContent = 'Freeze';
  }
  setMeasureError('');
}

async function toggleMeasure() {
  state.measuring = !state.measuring;
  btnMeasure.setAttribute('aria-pressed', state.measuring ? 'true' : 'false');
  if (state.measuring) {
    await enableMeasure();
  } else {
    disableMeasure();
  }
}

function toggleFreeze() {
  if (!state.measuring) return;
  if (!state.frozen) {
    if (state.measuredDeg == null) {
      setMeasureError('No reading to freeze yet — hold phone on the face first.');
      return;
    }
    state.frozen = true;
    state.frozenDeg = state.measuredDeg;
    btnFreeze.setAttribute('aria-pressed', 'true');
    btnFreeze.textContent = 'Live';
    setMeasureError('');
  } else {
    state.frozen = false;
    state.frozenDeg = null;
    btnFreeze.setAttribute('aria-pressed', 'false');
    btnFreeze.textContent = 'Freeze';
  }
  updateMeasureUI();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* ignore — preview may use different base */
    });
  });
}

// UI wiring
btnStart.addEventListener('click', startCamera);
btnInfo.addEventListener('click', () => infoDialog.showModal());

document.querySelectorAll('.soil-btn').forEach((btn) => {
  btn.addEventListener('click', () => setSoil(btn.dataset.soil));
});

scaleSlider.addEventListener('input', () => {
  state.scale = Number(scaleSlider.value) / 100;
  scaleSlider.setAttribute('aria-valuenow', scaleSlider.value);
  draw();
});

btnReset.addEventListener('click', resetOverlay);

btnFlip.addEventListener('click', () => {
  state.flip = !state.flip;
  if (state.bothWalls) {
    state.bothWalls = false;
    btnBoth.setAttribute('aria-pressed', 'false');
  }
  draw();
});

btnBoth.addEventListener('click', () => {
  state.bothWalls = !state.bothWalls;
  btnBoth.setAttribute('aria-pressed', state.bothWalls ? 'true' : 'false');
  draw();
});

canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
canvas.addEventListener('pointermove', onPointerMove, { passive: false });
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
canvas.addEventListener('touchend', onPointerUp);

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));


btnMeasure.addEventListener('click', () => {
  toggleMeasure().catch((err) => setMeasureError(err.message || String(err)));
});
btnFreeze.addEventListener('click', toggleFreeze);
window.addEventListener('orientationchange', () => {
  if (state.measuring) updateMeasureUI();
});

// Default soil B is common; set UI
setSoil('B');
btnBoth.setAttribute('aria-pressed', 'true');
resizeCanvas();
registerSW();

// Auto-prompt camera on secure contexts after a short beat (user can also tap)
if (window.isSecureContext) {
  // Don't auto-request — browsers need a gesture; gate CTA handles it.
}
