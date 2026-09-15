/**
 * Photo Stamp — capture/pick photo, overlay field metadata, download
 */
import { loadSettings, saveSettings, formatStamp, getGps, fmtGps, downloadBlob } from '../store.js';

let root, canvas, img, gps = null;

function html() {
  const s = loadSettings();
  return `
    <p class="muted">Stamp date, GPS, station, pipe data, and your name onto a field photo. Saved image downloads to your device.</p>
    <div class="card">
      <div class="btn-row">
        <label class="primary-btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">
          Camera / Gallery
          <input id="photo-file" type="file" accept="image/*" capture="environment" hidden />
        </label>
        <button type="button" class="secondary-btn" id="photo-gps">Refresh GPS</button>
      </div>
      <canvas id="photo-canvas" class="preview-canvas" width="800" height="600"></canvas>
      <p class="muted" id="photo-gps-label">GPS: …</p>
    </div>
    <div class="card">
      <div class="field"><label>Inspector</label><input id="ps-name" value="${escapeAttr(s.inspectorName || '')}" /></div>
      <div class="field-row">
        <div class="field"><label>Station / MP</label><input id="ps-station" placeholder="e.g. 12+45" /></div>
        <div class="field"><label>Soil type</label>
          <select id="ps-soil"><option>A</option><option selected>B</option><option>C</option><option>N/A</option></select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Pipe size</label><input id="ps-size" placeholder='e.g. 4"' /></div>
        <div class="field"><label>Material</label><input id="ps-mat" placeholder="PE / steel / DI…" /></div>
      </div>
      <div class="field"><label>Note</label><textarea id="ps-note" placeholder="Short finding note"></textarea></div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="photo-redraw">Update stamp</button>
        <button type="button" class="primary-btn" id="photo-save">Download stamped</button>
      </div>
    </div>
  `;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function drawStamp() {
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

  const name = root.querySelector('#ps-name').value.trim();
  const station = root.querySelector('#ps-station').value.trim();
  const soil = root.querySelector('#ps-soil').value;
  const size = root.querySelector('#ps-size').value.trim();
  const mat = root.querySelector('#ps-mat').value.trim();
  const note = root.querySelector('#ps-note').value.trim();
  const lines = [
    formatStamp(),
    fmtGps(gps),
    station ? `Sta: ${station}` : null,
    [size, mat].filter(Boolean).join(' · ') || null,
    soil !== 'N/A' ? `Soil: Type ${soil}` : null,
    name ? `By: ${name}` : null,
    note || null,
  ].filter(Boolean);

  const pad = Math.max(12, Math.round(w * 0.02));
  const fontSize = Math.max(14, Math.round(w * 0.028));
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  const lineH = fontSize + 8;
  const boxH = pad * 2 + lines.length * lineH;
  const maxLine = Math.max(...lines.map((l) => ctx.measureText(l).width), 100);
  const boxW = Math.min(w - pad * 2, maxLine + pad * 2);

  ctx.fillStyle = 'rgba(15,23,42,0.78)';
  ctx.fillRect(pad, h - boxH - pad, boxW, boxH);
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, h - boxH - pad, boxW, boxH);
  ctx.fillStyle = '#f8fafc';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad * 2, h - boxH - pad + pad + (i + 1) * lineH - 4);
  });
}

async function refreshGps() {
  const label = root.querySelector('#photo-gps-label');
  label.textContent = 'Getting GPS…';
  gps = await getGps();
  label.textContent = fmtGps(gps);
  drawStamp();
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  img = new Image();
  img.onload = () => {
    drawStamp();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

export function mountPhoto(el) {
  root = el;
  root.innerHTML = html();
  canvas = root.querySelector('#photo-canvas');
  root.querySelector('#photo-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadImage(f);
  });
  root.querySelector('#photo-gps').addEventListener('click', refreshGps);
  root.querySelector('#photo-redraw').addEventListener('click', () => {
    saveSettings({ inspectorName: root.querySelector('#ps-name').value.trim() });
    drawStamp();
  });
  root.querySelector('#photo-save').addEventListener('click', () => {
    if (!img) {
      alert('Pick or capture a photo first.');
      return;
    }
    saveSettings({ inspectorName: root.querySelector('#ps-name').value.trim() });
    drawStamp();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = formatStamp().replace(/[: ]/g, '-');
      downloadBlob(`uig-stamp-${stamp}.jpg`, blob);
    }, 'image/jpeg', 0.92);
  });
  // placeholder
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px system-ui';
  ctx.fillText('No photo yet — tap Camera / Gallery', 40, canvas.height / 2);
  refreshGps();
}
