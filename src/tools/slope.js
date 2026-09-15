/**
 * Trench Slope — live camera + OSHA Type A/B/C overlays + toe/crest guide + clinometer Measure
 */
import { loadSettings, saveSettings } from '../store.js';

const SOILS = {
  A: { id: 'A', title: 'Type A', hv: 0.75, labelHV: '0.75:1 (¾:1)', color: '#38bdf8' },
  B: { id: 'B', title: 'Type B', hv: 1, labelHV: '1:1', color: '#fbbf24' },
  C: { id: 'C', title: 'Type C', hv: 1.5, labelHV: '1.5:1 (1½:1)', color: '#fb7185' },
};

function angleFromHorizontal(hv) {
  return (Math.atan(1 / hv) * 180) / Math.PI;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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

let wired = false;
const state = {
  soil: 'B',
  stream: null,
  baselineY: 0.62,
  anchorX: 0.5,
  scale: 1,
  flip: false,
  bothWalls: true,
  dragging: false,
  dragMode: null,
  lastPointer: null,
  pinchStartDist: null,
  pinchStartScale: 1,
  running: false,
  dpr: 1,
  measuring: false,
  orientationListening: false,
  measuredDeg: null,
  frozen: false,
  frozenDeg: null,
  orientHandler: null,
  active: false,
};

function els() {
  return {
    video: document.getElementById('camera'),
    canvas: document.getElementById('overlay'),
    gate: document.getElementById('camera-gate'),
    cameraError: document.getElementById('camera-error'),
    btnStart: document.getElementById('btn-start'),
    scaleSlider: document.getElementById('scale-slider'),
    btnReset: document.getElementById('btn-reset'),
    btnFlip: document.getElementById('btn-flip'),
    btnBoth: document.getElementById('btn-both'),
    metaTitle: document.getElementById('meta-title'),
    metaDetail: document.getElementById('meta-detail'),
    hudHint: document.getElementById('hud-hint'),
    alignStrip: document.getElementById('align-strip'),
    guideTip: document.getElementById('slope-guide-tip'),
    btnGuideGotIt: document.getElementById('btn-slope-guide-gotit'),
    btnShowGuide: document.getElementById('btn-show-guide'),
    lineSwatchSlope: document.getElementById('line-swatch-slope'),
    lineSwatchCrest: document.getElementById('line-swatch-crest'),
    btnMeasure: document.getElementById('btn-measure'),
    measurePanel: document.getElementById('measure-panel'),
    measAngleEl: document.getElementById('meas-angle'),
    measAllowedEl: document.getElementById('meas-allowed'),
    measDeltaEl: document.getElementById('meas-delta'),
    measStatusEl: document.getElementById('meas-status'),
    measErrorEl: document.getElementById('meas-error'),
    btnFreeze: document.getElementById('btn-freeze'),
  };
}

function currentSoil() {
  return SOILS[state.soil];
}

function updateMeta() {
  const e = els();
  const s = currentSoil();
  const approx = Math.round(angleFromHorizontal(s.hv));
  e.metaTitle.textContent = s.title;
  e.metaDetail.textContent = `H:V ${s.labelHV} · ≈${approx}° from horizontal`;
  if (e.lineSwatchSlope) {
    e.lineSwatchSlope.style.background = s.color;
    e.lineSwatchSlope.style.boxShadow = `0 0 0 2px ${s.color}33`;
  }
  if (e.lineSwatchCrest) {
    e.lineSwatchCrest.style.background = s.color;
    e.lineSwatchCrest.style.boxShadow = `0 0 0 1.5px ${s.color}`;
  }
  updateMeasureUI();
}

function setSoil(id) {
  if (!SOILS[id]) return;
  state.soil = id;
  saveSettings({ lastSoil: id });
  document.querySelectorAll('.soil-btn').forEach((btn) => {
    const on = btn.dataset.soil === id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateMeta();
  draw();
}

function resizeCanvas() {
  const { canvas } = els();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
  canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  draw();
}

function draw() {
  if (!state.active) return;
  const { canvas } = els();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);
  const soil = currentSoil();
  const hv = soil.hv;
  const color = soil.color;
  const baseY = state.baselineY * h;
  const ax = state.anchorX * w;
  const wallH = Math.max(40, h * 0.42 * state.scale);
  const run = wallH * hv;

  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(2,6,23,0.25)');
  g.addColorStop(0.55, 'rgba(2,6,23,0.05)');
  g.addColorStop(1, 'rgba(2,6,23,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const crestPoints = [];

  const drawLabel = (text, x, y, opts = {}) => {
    const padX = opts.padX ?? 10;
    const font = opts.font ?? '800 13px system-ui, sans-serif';
    const boxH = opts.boxH ?? 26;
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    const bx = x - (opts.align === 'left' ? 0 : opts.align === 'right' ? tw + padX * 2 : (tw + padX * 2) / 2);
    const by = y - Math.round(boxH / 2);
    // Shadow plate for contrast over bright camera frames
    roundRect(ctx, bx - 1, by - 1, tw + padX * 2 + 2, boxH + 2, 9);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    roundRect(ctx, bx, by, tw + padX * 2, boxH, 8);
    ctx.fillStyle = opts.bg ?? 'rgba(15,23,42,0.94)';
    ctx.fill();
    ctx.strokeStyle = opts.border ?? '#fde047';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = opts.fg ?? '#fde047';
    ctx.fillText(text, bx + padX, by + Math.round(boxH * 0.68));
  };

  const drawWall = (side) => {
    const toeX = ax;
    const crestX = ax + side * run;
    const crestY = baseY - wallH;
    crestPoints.push({ x: crestX, y: crestY, side });
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineTo(toeX, baseY);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(color, 0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toeX, baseY);
    ctx.lineTo(crestX, crestY);
    ctx.lineWidth = 10;
    ctx.strokeStyle = hexAlpha(color, 0.25);
    ctx.stroke();
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

  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(w, baseY);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fde047';
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(ax, baseY, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#fde047';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();

  // TOE label — yellow baseline = bottom of ditch
  const toeLabelY = Math.min(h - 22, baseY + 32);
  drawLabel('TOE — bottom of ditch', ax, toeLabelY, {
    bg: 'rgba(15,23,42,0.95)',
    border: '#fde047',
    fg: '#fef08a',
  });

  // CREST labels — top of cut / start of slope from grade
  if (crestPoints.length === 1) {
    const cp = crestPoints[0];
    drawLabel('CREST — top of cut', cp.x, Math.max(22, cp.y - 22), {
      border: color,
      fg: '#ffffff',
      bg: 'rgba(15,23,42,0.95)',
    });
  } else {
    crestPoints.forEach((cp) => {
      const lx = cp.side < 0 ? cp.x - 8 : cp.x + 8;
      drawLabel('CREST — top', lx, Math.max(22, cp.y - 22), {
        align: cp.side < 0 ? 'right' : 'left',
        border: color,
        fg: '#ffffff',
        bg: 'rgba(15,23,42,0.95)',
      });
    });
    // One explanatory caption near the higher crest
    const mid = crestPoints[0];
    drawLabel('top of cut / start of slope', w / 2, Math.max(48, mid.y - 46), {
      border: hexAlpha(color, 0.85),
      fg: '#f8fafc',
      bg: 'rgba(15,23,42,0.92)',
      font: '800 12px system-ui, sans-serif',
      boxH: 24,
    });
  }

  const approx = Math.round(angleFromHorizontal(hv));
  const label = `${soil.title}  ${soil.labelHV}  ≈${approx}°`;
  ctx.font = '700 15px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  roundRect(ctx, 12, 12, tw + 24, 36, 10);
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(label, 24, 34);

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


function showAlignStrip(on) {
  const e = els();
  if (!e.alignStrip) return;
  e.alignStrip.hidden = !on;
}

function openGuideTip() {
  const e = els();
  if (!e.guideTip) return;
  e.guideTip.hidden = false;
  if (e.hudHint) e.hudHint.style.opacity = '0';
}

function showGuideTipIfNeeded() {
  const e = els();
  if (!e.guideTip) return;
  const settings = loadSettings();
  if (settings.slopeGuideSeen) {
    e.guideTip.hidden = true;
    return;
  }
  openGuideTip();
}

function dismissGuideTip() {
  const e = els();
  saveSettings({ slopeGuideSeen: true });
  if (e.guideTip) e.guideTip.hidden = true;
  if (e.hudHint && state.running) {
    e.hudHint.style.opacity = '0.95';
    setTimeout(() => {
      if (e.hudHint) e.hudHint.style.opacity = '0.35';
    }, 4500);
  }
}

async function startCamera() {
  const e = els();
  e.cameraError.hidden = true;
  e.cameraError.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    e.cameraError.hidden = false;
    e.cameraError.textContent = 'Camera API not available. Open over HTTPS on a phone.';
    return;
  }
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
      e.video.srcObject = stream;
      await e.video.play();
      e.gate.hidden = true;
      state.running = true;
      showAlignStrip(true);
      showGuideTipIfNeeded();
      if (e.hudHint) {
        e.hudHint.textContent = 'Drag TOE to trench bottom · scale CREST to grade';
      }
      resizeCanvas();
      requestAnimationFrame(loop);
      const tipVisible = e.guideTip && !e.guideTip.hidden;
      if (!tipVisible) {
        setTimeout(() => {
          if (e.hudHint) e.hudHint.style.opacity = '0.35';
        }, 5000);
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  e.cameraError.hidden = false;
  e.cameraError.textContent =
    lastErr?.name === 'NotAllowedError'
      ? 'Camera permission denied. Allow camera access and try again.'
      : `Could not start camera: ${lastErr?.message || lastErr}`;
}

function stopCamera() {
  state.running = false;
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  const e = els();
  if (e.video) e.video.srcObject = null;
  if (e.gate) e.gate.hidden = false;
  showAlignStrip(false);
  if (e.guideTip) e.guideTip.hidden = true;
}

function loop() {
  if (!state.running || !state.active) return;
  draw();
  requestAnimationFrame(loop);
}

function cssPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(ev) {
  ev.preventDefault();
  const e = els();
  if (e.hudHint) e.hudHint.style.opacity = '0';
  const canvas = e.canvas;
  if (ev.touches && ev.touches.length === 2) {
    const rect = canvas.getBoundingClientRect();
    const p1 = { x: ev.touches[0].clientX - rect.left, y: ev.touches[0].clientY - rect.top };
    const p2 = { x: ev.touches[1].clientX - rect.left, y: ev.touches[1].clientY - rect.top };
    state.pinchStartDist = dist(p1, p2);
    state.pinchStartScale = state.scale;
    state.dragging = false;
    return;
  }
  const p = cssPoint(ev, canvas);
  const h = canvas.clientHeight;
  const w = canvas.clientWidth;
  const baseY = state.baselineY * h;
  const ax = state.anchorX * w;
  if (Math.abs(p.y - baseY) < 36 || dist(p, { x: ax, y: baseY }) < 40) {
    state.dragging = true;
    state.dragMode = dist(p, { x: ax, y: baseY }) < 48 ? 'pan' : 'baseline';
  } else {
    state.dragging = true;
    state.dragMode = 'pan';
  }
  state.lastPointer = p;
}

function onPointerMove(ev) {
  ev.preventDefault();
  const e = els();
  const canvas = e.canvas;
  if (ev.touches && ev.touches.length === 2 && state.pinchStartDist) {
    const rect = canvas.getBoundingClientRect();
    const p1 = { x: ev.touches[0].clientX - rect.left, y: ev.touches[0].clientY - rect.top };
    const p2 = { x: ev.touches[1].clientX - rect.left, y: ev.touches[1].clientY - rect.top };
    const d = dist(p1, p2);
    state.scale = clamp(state.pinchStartScale * (d / state.pinchStartDist), 0.4, 2.2);
    e.scaleSlider.value = String(Math.round(state.scale * 100));
    draw();
    return;
  }
  if (!state.dragging || !state.lastPointer) return;
  const p = cssPoint(ev, canvas);
  const h = canvas.clientHeight;
  const w = canvas.clientWidth;
  if (state.dragMode === 'baseline') {
    state.baselineY = clamp(p.y / h, 0.15, 0.9);
  } else {
    state.anchorX = clamp(state.anchorX + (p.x - state.lastPointer.x) / w, 0.08, 0.92);
    state.baselineY = clamp(state.baselineY + (p.y - state.lastPointer.y) / h, 0.15, 0.9);
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

function resetOverlay() {
  const e = els();
  state.baselineY = 0.62;
  state.anchorX = 0.5;
  state.scale = 1;
  e.scaleSlider.value = '100';
  draw();
}

function angleFromOrientation(beta, gamma) {
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  let deg;
  if (landscape) {
    deg = Math.abs(gamma ?? 0);
    if (deg > 90) deg = 180 - deg;
  } else {
    let b = beta ?? 0;
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
  const e = els();
  if (!e.measErrorEl) return;
  if (msg) {
    e.measErrorEl.hidden = false;
    e.measErrorEl.textContent = msg;
  } else {
    e.measErrorEl.hidden = true;
    e.measErrorEl.textContent = '';
  }
}

function updateMeasureUI() {
  const e = els();
  if (!e.measurePanel || e.measurePanel.hidden) return;
  const allowed = requiredMaxDeg();
  e.measAllowedEl.textContent = `${Math.round(allowed)}°`;
  const live = state.frozen ? state.frozenDeg : state.measuredDeg;
  if (live == null || Number.isNaN(live)) {
    e.measAngleEl.textContent = '—°';
    e.measDeltaEl.textContent = '—';
    e.measStatusEl.dataset.state = state.frozen ? 'frozen' : 'idle';
    e.measStatusEl.textContent = state.frozen ? 'FROZEN — no reading' : 'Waiting for sensor…';
    return;
  }
  const measured = live;
  const delta = measured - allowed;
  const pass = measured <= allowed + 1;
  e.measAngleEl.textContent = `${(Math.round(measured * 10) / 10).toFixed(1)}°`;
  const dr = Math.round(delta * 10) / 10;
  e.measDeltaEl.textContent = `${dr > 0 ? '+' : ''}${dr.toFixed(1)}°`;
  e.measDeltaEl.style.color = pass ? 'var(--ok)' : 'var(--danger)';
  e.measStatusEl.dataset.state = pass ? 'pass' : 'fail';
  e.measStatusEl.textContent = state.frozen
    ? pass
      ? 'PASS (held)'
      : 'TOO STEEP (held)'
    : pass
      ? 'PASS'
      : 'TOO STEEP';
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
  if (!DOE) throw new Error('Device orientation is not supported in this browser.');
  if (typeof DOE.requestPermission === 'function') {
    const result = await DOE.requestPermission();
    if (result !== 'granted') throw new Error('Motion permission denied.');
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
  const e = els();
  setMeasureError('');
  state.frozen = false;
  state.frozenDeg = null;
  state.measuredDeg = null;
  if (e.btnFreeze) {
    e.btnFreeze.setAttribute('aria-pressed', 'false');
    e.btnFreeze.textContent = 'Freeze';
  }
  try {
    await requestOrientationPermission();
  } catch (err) {
    setMeasureError(err.message || String(err));
    e.measurePanel.hidden = false;
    updateMeasureUI();
    return;
  }
  startOrientation();
  e.measurePanel.hidden = false;
  updateMeasureUI();
  setTimeout(() => {
    if (state.measuring && !state.frozen && state.measuredDeg == null && !e.measErrorEl?.textContent) {
      setMeasureError('No tilt data yet. Use a phone with motion sensors over HTTPS.');
    }
  }, 2500);
}

function disableMeasure() {
  const e = els();
  stopOrientation();
  state.frozen = false;
  state.frozenDeg = null;
  state.measuredDeg = null;
  if (e.measurePanel) e.measurePanel.hidden = true;
  if (e.btnFreeze) {
    e.btnFreeze.setAttribute('aria-pressed', 'false');
    e.btnFreeze.textContent = 'Freeze';
  }
  setMeasureError('');
}

async function toggleMeasure() {
  const e = els();
  state.measuring = !state.measuring;
  e.btnMeasure.setAttribute('aria-pressed', state.measuring ? 'true' : 'false');
  if (state.measuring) await enableMeasure();
  else disableMeasure();
}

function toggleFreeze() {
  const e = els();
  if (!state.measuring) return;
  if (!state.frozen) {
    if (state.measuredDeg == null) {
      setMeasureError('No reading to freeze yet.');
      return;
    }
    state.frozen = true;
    state.frozenDeg = state.measuredDeg;
    e.btnFreeze.setAttribute('aria-pressed', 'true');
    e.btnFreeze.textContent = 'Live';
    setMeasureError('');
  } else {
    state.frozen = false;
    state.frozenDeg = null;
    e.btnFreeze.setAttribute('aria-pressed', 'false');
    e.btnFreeze.textContent = 'Freeze';
  }
  updateMeasureUI();
}

function wireOnce() {
  if (wired) return;
  wired = true;
  const e = els();
  e.btnStart.addEventListener('click', startCamera);
  if (e.btnGuideGotIt) {
    e.btnGuideGotIt.addEventListener('click', dismissGuideTip);
  }
  if (e.btnShowGuide) {
    e.btnShowGuide.addEventListener('click', openGuideTip);
  }
  document.querySelectorAll('.soil-btn').forEach((btn) => {
    btn.addEventListener('click', () => setSoil(btn.dataset.soil));
  });
  e.scaleSlider.addEventListener('input', () => {
    state.scale = Number(e.scaleSlider.value) / 100;
    draw();
  });
  e.btnReset.addEventListener('click', resetOverlay);
  e.btnFlip.addEventListener('click', () => {
    state.flip = !state.flip;
    if (state.bothWalls) {
      state.bothWalls = false;
      e.btnBoth.setAttribute('aria-pressed', 'false');
    }
    draw();
  });
  e.btnBoth.addEventListener('click', () => {
    state.bothWalls = !state.bothWalls;
    e.btnBoth.setAttribute('aria-pressed', state.bothWalls ? 'true' : 'false');
    draw();
  });
  e.canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  e.canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  e.canvas.addEventListener('pointerup', onPointerUp);
  e.canvas.addEventListener('pointercancel', onPointerUp);
  e.canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  e.canvas.addEventListener('touchmove', onPointerMove, { passive: false });
  e.canvas.addEventListener('touchend', onPointerUp);
  window.addEventListener('resize', () => {
    if (state.active) resizeCanvas();
  });
  window.addEventListener('orientationchange', () => {
    if (state.active) setTimeout(resizeCanvas, 200);
    if (state.measuring) updateMeasureUI();
  });
  e.btnMeasure.addEventListener('click', () => {
    toggleMeasure().catch((err) => setMeasureError(err.message || String(err)));
  });
  e.btnFreeze.addEventListener('click', toggleFreeze);
}

export function enterSlope() {
  wireOnce();
  state.active = true;
  const settings = loadSettings();
  setSoil(settings.lastSoil || 'B');
  els().btnBoth.setAttribute('aria-pressed', state.bothWalls ? 'true' : 'false');
  resizeCanvas();
}

export function leaveSlope() {
  state.active = false;
  if (state.measuring) {
    state.measuring = false;
    const e = els();
    if (e.btnMeasure) e.btnMeasure.setAttribute('aria-pressed', 'false');
    disableMeasure();
  }
  stopCamera();
}

export const slopeHelp = `
  <p>Overlay OSHA sloping angles for soil Types A, B, and C on the live camera.</p>
  <ul>
    <li><strong>Type A</strong> — ¾:1 (≈53°)</li>
    <li><strong>Type B</strong> — 1:1 (≈45°)</li>
    <li><strong>Type C</strong> — 1½:1 (≈34°)</li>
  </ul>
  <p><strong>Line guide:</strong> yellow dashed = <strong>TOE</strong> (trench floor); colored line = required OSHA slope face; colored dot = <strong>CREST</strong> (top of cut). Stand for a cross-section view, drag TOE to the bottom, then scale so CREST meets grade.</p>
  <p>Optional: tap <strong>Measure angle</strong> and hold the phone flat against the soil face to check tilt vs the allowed max.</p>
  <p class="disclaimer">Educational / field reference only. A competent person must classify soil and select protective systems.</p>
`;
