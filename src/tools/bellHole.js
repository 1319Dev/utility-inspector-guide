/**
 * Bell Hole — camera capture + approval checklist + stamped photo / summary
 */
import {
  loadSettings,
  saveSettings,
  formatStamp,
  getGps,
  fmtGps,
  downloadBlob,
  downloadText,
  uid,
} from '../store.js';
import { autofillStationField } from '../stationResolve.js';

const CHECKS = [
  { id: 'walls', label: 'Excavation walls stable / no cave-in hazard observed' },
  { id: 'spoil', label: 'Spoil / equipment set back ≥ 2 ft from edge' },
  { id: 'egress', label: 'Safe egress / ladder available if required by depth' },
  { id: 'shoring', label: 'Protective system OK (slope / bench / shield / box) or N/A' },
  { id: 'pipe', label: 'Pipe supported / padded; no unsupported span hazard' },
  { id: 'water', label: 'Water accumulation controlled / pumps as needed' },
  { id: 'atmos', label: 'Atmosphere checked if confined / as required by procedure' },
  { id: 'traffic', label: 'Traffic / public protection adequate' },
  { id: 'marks', label: '811 / locate marks visible and respected' },
  { id: 'access', label: 'Safe access for workers and inspection' },
];

let root = null;
let stream = null;
let img = null;
let gps = null;
let verdict = 'needs'; // pass | fail | needs

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const video = root?.querySelector('#bh-video');
  if (video) video.srcObject = null;
}

async function startCamera() {
  stopCamera();
  const video = root.querySelector('#bh-video');
  const errEl = root.querySelector('#bh-cam-err');
  errEl.textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play();
    root.querySelector('#bh-preview-wrap').hidden = false;
  } catch (err) {
    errEl.textContent = `Camera error: ${err.message || err}. You can still pick a photo from gallery.`;
  }
}

function loadImageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  img = new Image();
  img.onload = () => {
    drawStamp();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

async function captureFrame() {
  const video = root.querySelector('#bh-video');
  if (!video?.videoWidth) {
    root.querySelector('#bh-cam-err').textContent = 'Start camera first, then capture.';
    return;
  }
  gps = await getGps();
  const gpsLabel = root.querySelector('#bh-gps-label');
  if (gpsLabel) gpsLabel.textContent = fmtGps(gps);
  await autofillStation(gps);
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  c.toBlob((blob) => {
    if (blob) loadImageFromBlob(blob);
  }, 'image/jpeg', 0.92);
}

function checklistState() {
  const out = {};
  CHECKS.forEach((c) => {
    out[c.id] = !!root.querySelector(`#bh-chk-${c.id}`)?.checked;
  });
  return out;
}

function allChecked(state) {
  return CHECKS.every((c) => state[c.id]);
}

function drawStamp() {
  const canvas = root.querySelector('#bh-canvas');
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');
  const maxW = 1600;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > maxW) {
    h = Math.round((h * maxW) / w);
    w = maxW;
  }
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  const s = loadSettings();
  const name = root.querySelector('#bh-name').value.trim() || s.inspectorName || '';
  const station = root.querySelector('#bh-station').value.trim() || s.currentStation || '';
  const note = root.querySelector('#bh-note').value.trim();
  const checks = checklistState();
  const checkedN = Object.values(checks).filter(Boolean).length;
  const verdictLabel =
    verdict === 'pass' ? 'APPROVED (field)' : verdict === 'fail' ? 'NOT APPROVED' : 'NEEDS WORK';

  const lines = [
    `BELL HOLE · ${verdictLabel}`,
    formatStamp(),
    fmtGps(gps),
    station ? `Sta: ${station}` : null,
    name ? `By: ${name}` : null,
    `Checklist: ${checkedN}/${CHECKS.length}`,
    note || null,
  ].filter(Boolean);

  const pad = Math.max(12, Math.round(w * 0.02));
  const fontSize = Math.max(14, Math.round(w * 0.026));
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  const lineH = fontSize + 8;
  const boxH = pad * 2 + lines.length * lineH;
  const maxLine = Math.max(...lines.map((l) => ctx.measureText(l).width), 120);
  const boxW = Math.min(w - pad * 2, maxLine + pad * 2);

  const border =
    verdict === 'pass' ? '#22c55e' : verdict === 'fail' ? '#f87171' : '#fbbf24';
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fillRect(pad, h - boxH - pad, boxW, boxH);
  ctx.strokeStyle = border;
  ctx.lineWidth = 4;
  ctx.strokeRect(pad, h - boxH - pad, boxW, boxH);
  ctx.fillStyle = '#f8fafc';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad * 2, h - boxH - pad + pad + (i + 1) * lineH - 4);
  });
}

function setVerdict(v) {
  verdict = v;
  root.querySelectorAll('[data-verdict]').forEach((b) => {
    b.classList.toggle('active', b.dataset.verdict === v);
  });
  drawStamp();
  const box = root.querySelector('#bh-verdict-box');
  if (!box) return;
  const label =
    v === 'pass' ? 'Field APPROVED (checklist aid)' : v === 'fail' ? 'NOT APPROVED' : 'NEEDS WORK';
  box.className = 'result-box ' + (v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : '');
  box.innerHTML = `<div class="big">${label}</div><div class="muted">Not engineering sign-off — competent person / company procedure rules.</div>`;
}

function buildSummary() {
  const s = loadSettings();
  const name = root.querySelector('#bh-name').value.trim() || s.inspectorName || '';
  const station = root.querySelector('#bh-station').value.trim() || s.currentStation || '';
  const note = root.querySelector('#bh-note').value.trim();
  const checks = checklistState();
  const lines = [
    'Bell Hole field checklist',
    `When: ${formatStamp()}`,
    `GPS: ${fmtGps(gps)}`,
    `Station: ${station || 'n/a'}`,
    `Inspector: ${name || 'n/a'}`,
    `Verdict: ${verdict}`,
    '',
    'Checklist:',
    ...CHECKS.map((c) => `  [${checks[c.id] ? 'x' : ' '}] ${c.label}`),
    '',
    `Note: ${note || 'n/a'}`,
    '',
    'Disclaimer: Educational field aid only. Not engineering approval.',
  ];
  return { text: lines.join('\n'), checks, name, station, note };
}


async function autofillStation(gpsOverride) {
  const input = root?.querySelector('#bh-station');
  const status = root?.querySelector('#bh-sta-status');
  if (!input) return null;
  const opts = gpsOverride !== undefined ? { gps: gpsOverride } : {};
  return autofillStationField(input, status, opts);
}

export function leaveBellHole() {
  stopCamera();
}

export function mountBellHole(el) {
  root = el;
  const s = loadSettings();
  verdict = 'needs';
  img = null;
  gps = null;

  el.innerHTML = `
    <p class="muted">Capture a bell hole photo and run a glove-friendly approval checklist. Station autofills from Station Locator (live/saved). Stamped photo + text/JSON export. <strong>Not engineering approval</strong> — follow your competent person and company procedure.</p>

    <div class="card">
      <h3>Camera</h3>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="bh-start-cam">Start rear camera</button>
        <button type="button" class="secondary-btn" id="bh-capture" disabled>Capture</button>
        <label class="secondary-btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">
          Gallery
          <input id="bh-file" type="file" accept="image/*" capture="environment" hidden />
        </label>
      </div>
      <p class="muted" id="bh-cam-err"></p>
      <div id="bh-preview-wrap" hidden>
        <video id="bh-video" class="bh-video" playsinline muted autoplay></video>
      </div>
      <canvas id="bh-canvas" class="preview-canvas" width="800" height="600"></canvas>
      <p class="muted" id="bh-gps-label">GPS: …</p>
      <button type="button" class="secondary-btn" id="bh-gps">Refresh GPS</button>
    </div>

    <div class="card">
      <h3>Meta</h3>
      <div class="field"><label>Inspector</label><input id="bh-name" value="${escapeAttr(s.inspectorName || '')}" /></div>
      <div class="field"><label>Station</label><input id="bh-station" placeholder="e.g. 26+00" value="${escapeAttr(s.currentStation || '')}" /></div>
      <p class="muted" id="bh-sta-status">Station auto: …</p>
      <div class="field"><label>Note</label><textarea id="bh-note" placeholder="Bell hole location / finding"></textarea></div>
    </div>

    <div class="card">
      <h3>Approval checklist</h3>
      <div class="bh-checks">
        ${CHECKS.map(
          (c) => `
          <label class="bh-check">
            <input type="checkbox" id="bh-chk-${c.id}" />
            <span>${c.label}</span>
          </label>`
        ).join('')}
      </div>
      <div class="segment" id="bh-verdicts" role="group" aria-label="Verdict" style="margin-top:12px">
        <button type="button" data-verdict="pass">Pass</button>
        <button type="button" class="active" data-verdict="needs">Needs work</button>
        <button type="button" data-verdict="fail">Fail</button>
      </div>
      <div class="result-box" id="bh-verdict-box" style="margin-top:10px">
        <div class="big">NEEDS WORK</div>
        <div class="muted">Not engineering sign-off — competent person / company procedure rules.</div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button type="button" class="secondary-btn" id="bh-redraw">Update stamp</button>
        <button type="button" class="primary-btn" id="bh-save-photo">Download stamped</button>
        <button type="button" class="secondary-btn" id="bh-save-txt">Export text</button>
        <button type="button" class="secondary-btn" id="bh-save-json">Export JSON</button>
      </div>
    </div>
  `;

  const captureBtn = el.querySelector('#bh-capture');
  el.querySelector('#bh-start-cam').addEventListener('click', async () => {
    await startCamera();
    captureBtn.disabled = !stream;
  });
  captureBtn.addEventListener('click', captureFrame);
  el.querySelector('#bh-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    gps = await getGps();
    el.querySelector('#bh-gps-label').textContent = fmtGps(gps);
    await autofillStation(gps);
    loadImageFromBlob(f);
  });

  el.querySelector('#bh-gps').addEventListener('click', async () => {
    const label = el.querySelector('#bh-gps-label');
    label.textContent = 'Getting GPS…';
    gps = await getGps();
    label.textContent = fmtGps(gps);
    await autofillStation(gps);
    drawStamp();
  });

  el.querySelector('#bh-verdicts').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-verdict]');
    if (!btn) return;
    const v = btn.dataset.verdict;
    if (v === 'pass') {
      const state = checklistState();
      if (!allChecked(state)) {
        const go = confirm(
          'Not all checklist items are checked. Mark Pass anyway? (Still not engineering approval.)'
        );
        if (!go) return;
      }
    }
    setVerdict(v);
  });

  CHECKS.forEach((c) => {
    el.querySelector(`#bh-chk-${c.id}`)?.addEventListener('change', () => drawStamp());
  });
  ;['#bh-name', '#bh-station', '#bh-note'].forEach((sel) => {
    el.querySelector(sel)?.addEventListener('input', () => drawStamp());
  });

  el.querySelector('#bh-redraw').addEventListener('click', () => {
    saveSettings({ inspectorName: el.querySelector('#bh-name').value.trim() });
    drawStamp();
  });

  el.querySelector('#bh-save-photo').addEventListener('click', () => {
    if (!img) {
      alert('Capture or pick a photo first.');
      return;
    }
    saveSettings({
      inspectorName: el.querySelector('#bh-name').value.trim(),
      currentStation: el.querySelector('#bh-station').value.trim() || loadSettings().currentStation,
    });
    drawStamp();
    const canvas = el.querySelector('#bh-canvas');
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(`uig-bellhole-${formatStamp().replace(/[: ]/g, '-')}.jpg`, blob);
    }, 'image/jpeg', 0.92);
  });

  el.querySelector('#bh-save-txt').addEventListener('click', () => {
    const { text } = buildSummary();
    downloadText(`uig-bellhole-${uid()}.txt`, text);
  });

  el.querySelector('#bh-save-json').addEventListener('click', () => {
    const { checks, name, station, note } = buildSummary();
    const payload = {
      id: uid(),
      type: 'bell-hole',
      when: formatStamp(),
      gps,
      station,
      inspector: name,
      verdict,
      checks,
      note,
      disclaimer: 'Educational field aid only. Not engineering approval.',
    };
    downloadText(`uig-bellhole-${payload.id}.json`, JSON.stringify(payload, null, 2), 'application/json');
  });

  const ctx = el.querySelector('#bh-canvas').getContext('2d');
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, 800, 600);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px system-ui';
  ctx.fillText('No photo yet — start camera or pick from gallery', 40, 300);

  (async () => {
    gps = await getGps();
    el.querySelector('#bh-gps-label').textContent = fmtGps(gps);
    await autofillStation(gps);
  })();
}
