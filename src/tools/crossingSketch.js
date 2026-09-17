/**
 * Pipeline Crossing Sketch Designer — field documentation tool.
 * iPhone-first; measurements are inspector-entered, never inferred from pixels.
 */

import { loadSettings, uid, getGps, fmtGps } from '../store.js';
import {
  ADD_ITEMS,
  CROSSING_TYPES,
  MEASURE_TYPES,
  PHOTO_LABELS,
  UTILITY_STATUS,
  UTILITY_TYPES,
  blankCrossing,
  cloneObject,
  getGeom,
  isUnknownUtility,
  makeDisplayName,
  makeObject,
  matchesQuery,
  measureTypeLabel,
  parseLength,
  roundTrip,
  serializeCrossing,
} from './crossing/model.js';
import {
  clearDraft,
  deleteCrossing,
  duplicateCrossing,
  listIndex,
  loadCrossing,
  loadDraft,
  saveCrossing,
  saveDraft,
} from './crossing/persist.js';
import {
  applyHandleDrag,
  collectSnapTargets,
  drawScene,
  hitHandle,
  hitTest,
  screenToWorld,
} from './crossing/draw.js';
import {
  compressPhoto,
  exportCsv,
  exportJpg,
  exportJson,
  exportPdf,
  exportPng,
} from './crossing/export.js';

const MAX_PHOTOS = 8;
const MAX_UNDO = 50;

let root = null;
let record = null;
let screen = 'library';
let viewMode = 'plan';
let selectionId = null;
let dirty = false;
let savedJson = '';
let undoStack = [];
let redoStack = [];
let toolMode = 'select';
let panelOpen = false;
let openSection = 'project';
let pointers = new Map();
let drag = null;
let pinch = null;
let measureDraft = null;
let groundDraft = null;
let ro = null;
let autosaveTimer = null;
let toastTimer = null;
let searchQuery = '';
let exportTarget = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function camera() {
  if (!record) return { x: 0, y: 0, scale: 1 };
  if (viewMode === 'profile') {
    record.cameraProfile = record.cameraProfile || { x: 0, y: 0, scale: 1 };
    return record.cameraProfile;
  }
  record.cameraPlan = record.cameraPlan || { x: 0, y: 0, scale: 1 };
  return record.cameraPlan;
}

function selected() {
  return record?.objects?.find((o) => o.id === selectionId) || null;
}

function markDirty() {
  dirty = true;
  updateSticky();
}

function pushUndo() {
  if (!record) return;
  undoStack.push(JSON.stringify(record.objects));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  markDirty();
}

function applyObjects(json) {
  record.objects = JSON.parse(json);
  if (selectionId && !record.objects.some((o) => o.id === selectionId)) selectionId = null;
  draw();
  renderSelBar();
  markDirty();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(record.objects));
  applyObjects(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(record.objects));
  applyObjects(redoStack.pop());
}

function toast(msg, danger = false) {
  const el = root?.querySelector('#cx-toast');
  if (!el) {
    window.alert(msg);
    return;
  }
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('danger', danger);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function updateSticky() {
  const saveBtn = root?.querySelector('[data-cx="save"]');
  const dot = root?.querySelector('#cx-dirty');
  if (saveBtn) saveBtn.disabled = screen !== 'editor';
  if (dot) dot.hidden = !dirty;
}

function canvasSize() {
  const canvas = root?.querySelector('#cx-canvas');
  if (!canvas) return { w: 360, h: 400, dpr: 1 };
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { w: rect.width, h: rect.height, dpr, canvas };
}

function resizeCanvas() {
  const { w, h, dpr, canvas } = canvasSize();
  if (!canvas) return;
  const cw = Math.max(1, Math.floor(w * dpr));
  const ch = Math.max(1, Math.floor(h * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  draw();
}

function draw() {
  const canvas = root?.querySelector('#cx-canvas');
  if (!canvas || !record || screen !== 'editor') return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(ctx, {
    record,
    view: viewMode,
    selectionId,
    camera: camera(),
    width: w,
    height: h,
    print: false,
    showHandles: true,
  });
  if (measureDraft) {
    ctx.save();
    const cam = camera();
    ctx.transform(cam.scale, 0, 0, cam.scale, -cam.x * cam.scale, -cam.y * cam.scale);
    ctx.strokeStyle = '#fde047';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2 / cam.scale;
    ctx.beginPath();
    ctx.moveTo(measureDraft.x1, measureDraft.y1);
    ctx.lineTo(measureDraft.x2, measureDraft.y2);
    ctx.stroke();
    ctx.restore();
  }
  if (groundDraft?.length) {
    ctx.save();
    const cam = camera();
    ctx.transform(cam.scale, 0, 0, cam.scale, -cam.x * cam.scale, -cam.y * cam.scale);
    ctx.strokeStyle = '#d6d3d1';
    ctx.fillStyle = '#fde047';
    ctx.lineWidth = 2 / cam.scale;
    ctx.beginPath();
    ctx.moveTo(groundDraft[0].x, groundDraft[0].y);
    for (let i = 1; i < groundDraft.length; i++) ctx.lineTo(groundDraft[i].x, groundDraft[i].y);
    ctx.stroke();
    for (const p of groundDraft) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / cam.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function centerWorld() {
  const { w, h } = canvasSize();
  const cam = camera();
  return {
    x: cam.x + w / 2 / cam.scale,
    y: cam.y + h / 2 / cam.scale,
  };
}

function addKind(kind) {
  closeSheet();
  if (kind === 'ground') {
    setMode('ground');
    toast('Tap grade points, then Done');
    return;
  }
  const { x, y } = centerWorld();
  pushUndo();
  const obj = makeObject(kind, viewMode, x, y, record.meta);
  record.objects.push(obj);
  selectionId = obj.id;
  markDirty();
  draw();
  renderSelBar();
  if (kind === 'pipeline' || kind === 'utility' || kind === 'unknown' || kind === 'excavation' || kind === 'bellhole') {
    openPropsSheet(obj);
  } else if (kind === 'label') {
    openLabelSheet(obj);
  }
  toast(kind === 'unknown' ? 'Unknown utility added — do not invent type or owner' : 'Object added — drag handles to adjust');
}

function setBanner(text, actions = '') {
  const el = root.querySelector('#cx-banner');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span>${esc(text)}</span>${actions}`;
}

function setMode(next) {
  toolMode = next;
  groundDraft = null;
  measureDraft = null;
  if (next === 'measure') setBanner('Drag a dimension line, then enter the actual field value.');
  else if (next === 'label') setBanner('Tap the canvas to place a label.');
  else if (next === 'ground') {
    groundDraft = [];
    setBanner(
      'Tap to add ground points.',
      `<button type="button" class="secondary-btn" data-cx="ground-done">Done</button>
       <button type="button" class="secondary-btn" data-cx="ground-cancel">Cancel</button>`
    );
  } else setBanner('');
}

/* ---------- screens ---------- */

function render() {
  if (!root) return;
  if (screen === 'library') root.innerHTML = libraryHtml();
  else if (screen === 'create') root.innerHTML = createHtml();
  else root.innerHTML = editorHtml();
  bindScreen();
}

function libraryHtml() {
  const draft = loadDraft();
  const items = listIndex().filter((e) => matchesQuery(e, searchQuery));
  return `
    <div class="cx-library">
      <p class="muted">Field sketch of how a utility crosses a pipeline. Schematic — not to scale. Entered measurements are the record; the app never guesses sizes, depths, owners, or types.</p>
      ${
        draft
          ? `<div class="cx-draft">
              <div>
                <strong>Draft in progress</strong>
                <p class="muted">${esc(draft.displayName || makeDisplayName(draft.meta))}</p>
              </div>
              <div class="btn-row">
                <button type="button" class="primary-btn" data-cx="resume-draft">Resume</button>
                <button type="button" class="secondary-btn" data-cx="discard-draft">Discard</button>
              </div>
            </div>`
          : ''
      }
      <button type="button" class="primary-btn cx-full" data-cx="new">Create New</button>
      <div class="field">
        <label for="cx-search">Search</label>
        <input id="cx-search" type="search" placeholder="Project, line, station, date, utility…" value="${esc(searchQuery)}" />
      </div>
      <div class="list" id="cx-list">
        ${
          items.length
            ? items
                .map(
                  (e) => `
          <article class="list-item cx-lib-card" data-id="${esc(e.id)}">
            <strong>${esc(e.displayName)}</strong>
            <span class="meta">${esc([e.project, e.lineName, e.station, e.crossingType].filter(Boolean).join(' · ') || 'No project fields')}</span>
            <span class="meta">${esc((e.utilityTypes || []).join(', ') || 'No utilities')} · ${e.photoCount || 0} photo${e.photoCount === 1 ? '' : 's'}</span>
            <div class="btn-row">
              <button type="button" class="primary-btn" data-cx="open" data-id="${esc(e.id)}">Open</button>
              <button type="button" class="secondary-btn" data-cx="dup" data-id="${esc(e.id)}">Duplicate</button>
              <button type="button" class="secondary-btn" data-cx="export-one" data-id="${esc(e.id)}">Export</button>
              <button type="button" class="danger-btn" data-cx="del" data-id="${esc(e.id)}">Delete</button>
            </div>
          </article>`
                )
                .join('')
            : `<p class="muted">${searchQuery ? 'No crossings match that search.' : 'No saved crossings yet.'}</p>`
        }
      </div>
      <div id="cx-sheet" class="cx-sheet" hidden>
        <button type="button" class="cx-sheet-backdrop" data-cx="sheet-close" aria-label="Close"></button>
        <div class="cx-sheet-panel" role="dialog" aria-modal="true">
          <div class="cx-sheet-handle"></div>
          <div id="cx-sheet-body" class="cx-sheet-body"></div>
        </div>
      </div>
      <div id="cx-toast" class="cx-toast" hidden></div>
    </div>
  `;
}

function createHtml() {
  const s = loadSettings();
  const meta = record?.meta || blankCrossing(s).meta;
  const types = CROSSING_TYPES.map(
    (t) => `<option value="${esc(t)}" ${t === (meta.crossingType || 'Underground') ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');
  return `
    <div class="cx-library">
      <p class="muted">Project block for this crossing. You can edit these later in Info.</p>
      <div class="card">
        <div class="field"><label>Project</label><input id="cx-project" value="${esc(meta.project)}" /></div>
        <div class="field"><label>Line / Pipeline name</label><input id="cx-line" value="${esc(meta.lineName)}" placeholder="e.g. SK" /></div>
        <div class="field"><label>Station</label><input id="cx-station" value="${esc(meta.station)}" placeholder="27+43" inputmode="text" /></div>
        <div class="field"><label>Date</label><input id="cx-date" type="date" value="${esc(meta.date)}" /></div>
        <div class="field"><label>Inspector</label><input id="cx-inspector" value="${esc(meta.inspector)}" /></div>
        <div class="field"><label>Contractor</label><input id="cx-contractor" value="${esc(meta.contractor)}" /></div>
        <div class="field"><label>Foreman</label><input id="cx-foreman" value="${esc(meta.foreman)}" /></div>
        <div class="field"><label>Location / description</label><textarea id="cx-location">${esc(meta.location)}</textarea></div>
        <div class="field"><label>Crossing type</label><select id="cx-xtype">${types}</select></div>
        <div class="field"><label>Notes</label><textarea id="cx-notes">${esc(meta.notes)}</textarea></div>
      </div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" data-cx="cancel-create">Cancel</button>
        <button type="button" class="primary-btn" data-cx="start-sketch">Start sketch</button>
      </div>
    </div>
  `;
}

function editorHtml() {
  return `
    <div class="cx-editor">
      <div class="cx-sticky">
        <div class="segment cx-viewseg" role="tablist" aria-label="View">
          <button type="button" data-cx="view" data-view="plan" class="${viewMode === 'plan' ? 'active' : ''}">Plan</button>
          <button type="button" data-cx="view" data-view="profile" class="${viewMode === 'profile' ? 'active' : ''}">Profile</button>
        </div>
        <button type="button" class="secondary-btn cx-info-btn" data-cx="info" aria-pressed="${panelOpen}">Info</button>
        <button type="button" class="primary-btn cx-save-btn" data-cx="save">Save <span id="cx-dirty" ${dirty ? '' : 'hidden'}>●</span></button>
      </div>
      <div class="cx-canvas-wrap">
        <canvas id="cx-canvas" aria-label="Crossing sketch canvas"></canvas>
        <div id="cx-banner" class="cx-banner" hidden></div>
        <div id="cx-selbar" class="cx-selbar" hidden></div>
      </div>
      <nav class="cx-toolbar" aria-label="Sketch tools">
        <button type="button" data-cx="add">Add</button>
        <button type="button" data-cx="measure">Measure</button>
        <button type="button" data-cx="label">Label</button>
        <button type="button" data-cx="undo">Undo</button>
        <button type="button" data-cx="more">More</button>
      </nav>
      <aside id="cx-panel" class="cx-panel" ${panelOpen ? '' : 'hidden'}></aside>
      <div id="cx-sheet" class="cx-sheet" hidden>
        <button type="button" class="cx-sheet-backdrop" data-cx="sheet-close" aria-label="Close"></button>
        <div class="cx-sheet-panel" role="dialog" aria-modal="true">
          <div class="cx-sheet-handle"></div>
          <div id="cx-sheet-body" class="cx-sheet-body"></div>
        </div>
      </div>
      <div id="cx-toast" class="cx-toast" hidden></div>
    </div>
  `;
}

function bindScreen() {
  if (screen === 'library') {
    root.querySelector('#cx-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      const keep = e.target;
      const start = keep.selectionStart;
      render();
      const next = root.querySelector('#cx-search');
      if (next) {
        next.focus();
        next.setSelectionRange(start, start);
      }
    });
  }
  if (screen === 'editor') {
    bindCanvas();
    renderPanel();
    renderSelBar();
    requestAnimationFrame(resizeCanvas);
    if (ro) ro.disconnect();
    const wrap = root.querySelector('.cx-canvas-wrap');
    ro = new ResizeObserver(() => resizeCanvas());
    if (wrap) ro.observe(wrap);
    window.addEventListener('resize', resizeCanvas);
  }
}

function collectCreateMeta() {
  return {
    project: root.querySelector('#cx-project')?.value.trim() || '',
    lineName: root.querySelector('#cx-line')?.value.trim() || '',
    station: root.querySelector('#cx-station')?.value.trim() || '',
    date: root.querySelector('#cx-date')?.value || '',
    inspector: root.querySelector('#cx-inspector')?.value.trim() || '',
    contractor: root.querySelector('#cx-contractor')?.value.trim() || '',
    foreman: root.querySelector('#cx-foreman')?.value.trim() || '',
    location: root.querySelector('#cx-location')?.value.trim() || '',
    crossingType: root.querySelector('#cx-xtype')?.value || '',
    notes: root.querySelector('#cx-notes')?.value.trim() || '',
    lat: record?.meta?.lat || '',
    lon: record?.meta?.lon || '',
    gpsAccuracy: record?.meta?.gpsAccuracy || '',
    gpsSource: record?.meta?.gpsSource || 'manual',
  };
}

function openEditor(rec, { isNew = false } = {}) {
  record = rec;
  record.displayName = makeDisplayName(record.meta);
  screen = 'editor';
  viewMode = 'plan';
  selectionId = null;
  panelOpen = false;
  toolMode = 'select';
  undoStack = [];
  redoStack = [];
  dirty = isNew;
  savedJson = isNew ? '' : JSON.stringify(serializeCrossing(record));
  render();
  startAutosave();
}

function openCreate() {
  record = blankCrossing(loadSettings());
  screen = 'create';
  dirty = false;
  render();
}

function backFromTool() {
  if (screen === 'editor') {
    flushDraft();
    if (dirty && !window.confirm('Unsaved edits. A draft is kept on this device. Return to library?')) return;
    stopAutosave();
    screen = 'library';
    record = null;
    render();
    return;
  }
  if (screen === 'create') {
    screen = 'library';
    record = null;
    render();
    return;
  }
  location.hash = '';
}

/* ---------- sheets / panel ---------- */

function openSheet(html) {
  const sheet = root.querySelector('#cx-sheet');
  const body = root.querySelector('#cx-sheet-body');
  if (!sheet || !body) return;
  body.innerHTML = html;
  sheet.hidden = false;
}

function closeSheet() {
  const sheet = root.querySelector('#cx-sheet');
  if (sheet) sheet.hidden = true;
}

function addSheetHtml() {
  const items = ADD_ITEMS.map(
    (it) => `
      <button type="button" class="cx-add-item" data-cx="add-kind" data-kind="${esc(it.kind)}">
        <strong>${esc(it.label)}</strong>
        <span>${esc(it.hint)}</span>
      </button>`
  ).join('');
  return `<h3>Add</h3><div class="cx-add-grid">${items}</div>
    <button type="button" class="secondary-btn cx-full" data-cx="sheet-close">Close</button>`;
}

function moreSheetHtml() {
  return `
    <h3>More</h3>
    <div class="cx-add-grid">
      <button type="button" class="cx-add-item" data-cx="redo"><strong>Redo</strong><span>Opposite of undo</span></button>
      <button type="button" class="cx-add-item" data-cx="dup-obj"><strong>Duplicate object</strong><span>Selected item</span></button>
      <button type="button" class="cx-add-item" data-cx="del-obj"><strong>Delete object</strong><span>Selected item</span></button>
      <button type="button" class="cx-add-item" data-cx="north"><strong>North arrow</strong><span>Plan view</span></button>
      <button type="button" class="cx-add-item" data-cx="arrow"><strong>Arrow</strong><span>Direction callout</span></button>
      <button type="button" class="cx-add-item" data-cx="clear"><strong>Clear canvas</strong><span>Keeps project fields</span></button>
      <button type="button" class="cx-add-item" data-cx="export-menu"><strong>Export</strong><span>PDF · PNG · JSON</span></button>
      <button type="button" class="cx-add-item" data-cx="photos-jump"><strong>Photos</strong><span>Attach to record</span></button>
    </div>
    <button type="button" class="secondary-btn cx-full" data-cx="sheet-close">Close</button>`;
}

function exportSheetHtml() {
  return `
    <h3>Export</h3>
    <p class="muted">PDF is a letter-size report with plan and profile images — not a phone screenshot. JSON is the editable record.</p>
    <div class="btn-row cx-stack">
      <button type="button" class="primary-btn" data-cx="ex-pdf">PDF report</button>
      <button type="button" class="secondary-btn" data-cx="ex-png-plan">PNG plan</button>
      <button type="button" class="secondary-btn" data-cx="ex-png-profile">PNG profile</button>
      <button type="button" class="secondary-btn" data-cx="ex-jpg-plan">JPG plan</button>
      <button type="button" class="secondary-btn" data-cx="ex-json">JSON data</button>
      <button type="button" class="secondary-btn" data-cx="ex-csv">CSV summary</button>
    </div>
    <button type="button" class="secondary-btn cx-full" data-cx="sheet-close">Close</button>`;
}

function openPropsSheet(obj) {
  if (!obj) return;
  if (obj.kind === 'pipeline') openSheet(pipelineForm(obj));
  else if (obj.kind === 'utility' || obj.kind === 'unknown') openSheet(utilityForm(obj));
  else if (obj.kind === 'measurement') openSheet(measureForm(obj));
  else if (obj.kind === 'label') openLabelSheet(obj);
  else if (obj.kind === 'excavation') openSheet(excavationForm(obj));
  else openSheet(simpleNotesForm(obj));
}

function pipelineForm(obj) {
  const p = obj.props || {};
  return `
    <h3>Pipeline</h3>
    <p class="muted">Leave blank if unknown. Key fields show beside the line on the sketch.</p>
    <div class="field"><label>Name</label><input id="pr-name" value="${esc(p.name)}" /></div>
    <div class="field"><label>Diameter</label><input id="pr-dia" value="${esc(p.diameter)}" placeholder='e.g. 16"' /></div>
    <div class="field"><label>Material</label><input id="pr-mat" value="${esc(p.material)}" placeholder="Steel / PE…" /></div>
    <div class="field"><label>Coating</label><input id="pr-coat" value="${esc(p.coating)}" /></div>
    <div class="field"><label>Station</label><input id="pr-sta" value="${esc(p.station)}" placeholder="27+43" /></div>
    <div class="field"><label>Depth / cover</label><input id="pr-depth" value="${esc(p.depth)}" placeholder="4'-6&quot; or 4.5" /></div>
    <div class="field"><label>Direction</label><input id="pr-dir" value="${esc(p.direction)}" placeholder="N–S" /></div>
    <div class="field"><label>Notes</label><textarea id="pr-notes">${esc(p.notes)}</textarea></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-pipe" data-id="${esc(obj.id)}">Done</button>`;
}

function utilityForm(obj) {
  const p = obj.props || {};
  const unknown = isUnknownUtility(obj);
  const types = UTILITY_TYPES.map(
    (t) => `<option value="${esc(t)}" ${t === (p.type || (unknown ? 'Unknown' : '')) ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');
  const status = UTILITY_STATUS.map(
    (t) => `<option value="${esc(t)}" ${t === (p.status || (unknown ? 'Unknown' : 'Active')) ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');
  return `
    <h3>${unknown ? 'Unknown utility' : 'Crossing utility'}</h3>
    ${unknown ? '<p class="muted">Labeled UNKNOWN UTILITY on the sketch. Do not invent type or owner.</p>' : ''}
    ${
      unknown
        ? `<input type="hidden" id="pr-type" value="Unknown" />`
        : `<div class="field"><label>Type</label><select id="pr-type">${types}</select></div>`
    }
    <div class="field"><label>Diameter</label><input id="pr-dia" value="${esc(p.diameter)}" placeholder='e.g. 4"' /></div>
    <div class="field"><label>Material</label><input id="pr-mat" value="${esc(p.material)}" /></div>
    <div class="field"><label>Owner / operator</label><input id="pr-owner" value="${esc(unknown ? '' : p.owner)}" ${unknown ? 'placeholder="Leave blank if unknown"' : ''} /></div>
    <div class="field"><label>Depth</label><input id="pr-depth" value="${esc(p.depth)}" placeholder="3'-4&quot; or 3.33" /></div>
    <div class="field"><label>Direction</label><input id="pr-dir" value="${esc(p.direction)}" /></div>
    <div class="field"><label>Status</label><select id="pr-status">${status}</select></div>
    <div class="field"><label>Notes</label><textarea id="pr-notes">${esc(p.notes)}</textarea></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-util" data-id="${esc(obj.id)}">Done</button>`;
}

function measureForm(obj) {
  const p = obj.props || {};
  const opts = MEASURE_TYPES.map(
    (t) => `<option value="${esc(t.id)}" ${t.id === (p.measureType || 'custom') ? 'selected' : ''}>${esc(t.label)}</option>`
  ).join('');
  return `
    <h3>Measurement</h3>
    <p class="muted">Type the <strong>actual</strong> field value (3'-4" or 3.33 ft). Pixel length on screen is not a scale.</p>
    <div class="field"><label>Type</label><select id="pr-mtype">${opts}</select></div>
    <div class="field"><label>Value</label><input id="pr-mval" value="${esc(p.valueText)}" placeholder="3'-4&quot;  or  3.33" /></div>
    <div class="field"><label>Note / reference</label><input id="pr-mlabel" value="${esc(p.label)}" /></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-meas" data-id="${esc(obj.id)}">Done</button>`;
}

function excavationForm(obj) {
  const p = obj.props || {};
  return `
    <h3>${p.type === 'bellhole' ? 'Bell hole' : 'Pothole / excavation'}</h3>
    <div class="field"><label>Kind</label>
      <select id="pr-ex-type">
        <option value="pothole" ${p.type !== 'bellhole' ? 'selected' : ''}>Pothole</option>
        <option value="bellhole" ${p.type === 'bellhole' ? 'selected' : ''}>Bell hole</option>
      </select>
    </div>
    <div class="field"><label>Width (entered)</label><input id="pr-ex-w" value="${esc(p.width)}" placeholder="5'-0&quot;" /></div>
    <div class="field"><label>Depth (entered)</label><input id="pr-ex-d" value="${esc(p.depth)}" /></div>
    <div class="field"><label>Notes</label><textarea id="pr-notes">${esc(p.notes)}</textarea></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-ex" data-id="${esc(obj.id)}">Done</button>`;
}

function simpleNotesForm(obj) {
  return `
    <h3>${esc(obj.kind)}</h3>
    <div class="field"><label>Notes</label><textarea id="pr-notes">${esc(obj.props?.notes || obj.props?.text || '')}</textarea></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-simple" data-id="${esc(obj.id)}">Done</button>`;
}

function openLabelSheet(obj) {
  openSheet(`
    <h3>Label</h3>
    <div class="field"><label>Text</label><input id="pr-text" value="${esc(obj.props?.text || '')}" placeholder="Callout" /></div>
    <button type="button" class="primary-btn cx-full" data-cx="save-label" data-id="${esc(obj.id)}">Done</button>`);
  queueMicrotask(() => root.querySelector('#pr-text')?.focus());
}

function objectById(id) {
  return record?.objects?.find((o) => o.id === id) || null;
}

function applyPipelineForm(id) {
  const obj = objectById(id);
  if (!obj) return;
  pushUndo();
  obj.props = {
    name: val('#pr-name'),
    diameter: val('#pr-dia'),
    material: val('#pr-mat'),
    coating: val('#pr-coat'),
    station: val('#pr-sta'),
    depth: val('#pr-depth'),
    direction: val('#pr-dir'),
    notes: val('#pr-notes'),
  };
  closeSheet();
  draw();
}

function applyUtilityForm(id) {
  const obj = objectById(id);
  if (!obj) return;
  pushUndo();
  const type = val('#pr-type') || (isUnknownUtility(obj) ? 'Unknown' : '');
  if (type === 'Unknown') obj.kind = 'unknown';
  else if (obj.kind === 'unknown' && type && type !== 'Unknown') obj.kind = 'utility';
  obj.props = {
    type,
    diameter: val('#pr-dia'),
    material: val('#pr-mat'),
    owner: type === 'Unknown' ? val('#pr-owner') : val('#pr-owner'),
    depth: val('#pr-depth'),
    direction: val('#pr-dir'),
    status: root.querySelector('#pr-status')?.value || 'Unknown',
    notes: val('#pr-notes'),
  };
  if (obj.kind === 'unknown') {
    obj.props.type = 'Unknown';
  }
  closeSheet();
  draw();
}

function applyMeasureForm(id) {
  const obj = objectById(id);
  if (!obj) return;
  pushUndo();
  const valueText = val('#pr-mval');
  const parsed = parseLength(valueText);
  obj.props = {
    measureType: root.querySelector('#pr-mtype')?.value || 'custom',
    valueText,
    valueFeet: parsed.feet,
    label: val('#pr-mlabel'),
  };
  closeSheet();
  draw();
}

function applyExForm(id) {
  const obj = objectById(id);
  if (!obj) return;
  pushUndo();
  obj.props = {
    type: root.querySelector('#pr-ex-type')?.value || 'pothole',
    width: val('#pr-ex-w'),
    depth: val('#pr-ex-d'),
    notes: val('#pr-notes'),
  };
  closeSheet();
  draw();
}

function val(sel) {
  return root.querySelector(sel)?.value.trim() || '';
}

function renderSelBar() {
  const bar = root?.querySelector('#cx-selbar');
  if (!bar) return;
  const obj = selected();
  if (!obj) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  const name =
    obj.kind === 'pipeline'
      ? 'Pipeline'
      : obj.kind === 'unknown'
        ? 'UNKNOWN UTILITY'
        : obj.kind === 'utility'
          ? obj.props?.type || 'Utility'
          : obj.kind === 'measurement'
            ? measureTypeLabel(obj.props?.measureType)
            : obj.kind;
  bar.innerHTML = `
    <span>${esc(name)}</span>
    <button type="button" class="secondary-btn" data-cx="edit-sel">Edit</button>
    <button type="button" class="secondary-btn" data-cx="dup-obj">Dup</button>
    <button type="button" class="danger-btn" data-cx="del-obj">Del</button>`;
}

function renderPanel() {
  const panel = root?.querySelector('#cx-panel');
  if (!panel || !record) return;
  const m = record.meta;
  const pipes = record.objects.filter((o) => o.kind === 'pipeline');
  const utils = record.objects.filter((o) => o.kind === 'utility' || o.kind === 'unknown');
  const meas = record.objects.filter((o) => o.kind === 'measurement');
  const sec = (id, title, body) => `
    <details class="cx-acc" data-sec="${id}" ${openSection === id ? 'open' : ''}>
      <summary>${esc(title)}</summary>
      <div class="cx-acc-body">${body}</div>
    </details>`;

  panel.innerHTML = `
    ${sec(
      'project',
      'Project',
      `<div class="field"><label>Project</label><input data-meta="project" value="${esc(m.project)}" /></div>
       <div class="field"><label>Line / Pipeline</label><input data-meta="lineName" value="${esc(m.lineName)}" /></div>
       <div class="field"><label>Station</label><input data-meta="station" value="${esc(m.station)}" placeholder="27+43" /></div>
       <div class="field"><label>Date</label><input data-meta="date" type="date" value="${esc(m.date)}" /></div>
       <div class="field"><label>Inspector</label><input data-meta="inspector" value="${esc(m.inspector)}" /></div>
       <div class="field"><label>Contractor</label><input data-meta="contractor" value="${esc(m.contractor)}" /></div>
       <div class="field"><label>Foreman</label><input data-meta="foreman" value="${esc(m.foreman)}" /></div>
       <div class="field"><label>Crossing type</label>
         <select data-meta="crossingType">${CROSSING_TYPES.map((t) => `<option ${t === m.crossingType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
       </div>`
    )}
    ${sec(
      'pipe',
      `Pipeline (${pipes.length})`,
      pipes.length
        ? pipes
            .map(
              (p) =>
                `<button type="button" class="cx-mini" data-cx="edit-id" data-id="${esc(p.id)}">${esc(p.props?.name || p.props?.diameter || 'Pipeline')}</button>`
            )
            .join('') + `<button type="button" class="secondary-btn cx-full" data-cx="add-kind" data-kind="pipeline">Add pipeline</button>`
        : `<p class="muted">None yet.</p><button type="button" class="secondary-btn cx-full" data-cx="add-kind" data-kind="pipeline">Add pipeline</button>`
    )}
    ${sec(
      'util',
      `Crossing utility (${utils.length})`,
      (utils.length
        ? utils
            .map(
              (u) =>
                `<button type="button" class="cx-mini" data-cx="edit-id" data-id="${esc(u.id)}">${esc(isUnknownUtility(u) ? 'UNKNOWN UTILITY' : u.props?.type || 'Utility')}</button>`
            )
            .join('')
        : `<p class="muted">None yet. Use Unknown if type/owner is not known.</p>`) +
        `<div class="btn-row"><button type="button" class="secondary-btn" data-cx="add-kind" data-kind="utility">Add utility</button>
         <button type="button" class="secondary-btn" data-cx="add-kind" data-kind="unknown">Add unknown</button></div>`
    )}
    ${sec(
      'meas',
      `Measurements (${meas.length})`,
      (meas.length
        ? `<ul class="cx-meas-list">${meas
            .map(
              (mm) =>
                `<li><button type="button" data-cx="edit-id" data-id="${esc(mm.id)}">${esc(measureTypeLabel(mm.props?.measureType))}: <strong>${esc(mm.props?.valueText || '(no value)')}</strong></button></li>`
            )
            .join('')}</ul>`
        : `<p class="muted">None entered. Values are typed by the inspector — never taken from pixel spacing.</p>`) +
        `<button type="button" class="secondary-btn cx-full" data-cx="measure">Add measurement</button>`
    )}
    ${sec(
      'loc',
      'Location',
      `<div class="field"><label>Location / description</label><textarea data-meta="location">${esc(m.location)}</textarea></div>
       <div class="field-row">
         <div class="field"><label>Latitude</label><input data-meta="lat" inputmode="decimal" value="${esc(m.lat)}" placeholder="32.12345" /></div>
         <div class="field"><label>Longitude</label><input data-meta="lon" inputmode="decimal" value="${esc(m.lon)}" placeholder="-96.12345" /></div>
       </div>
       <p class="muted">Manual entry for V1. ${m.gpsAccuracy ? esc(`Last GPS accuracy: ${m.gpsAccuracy}`) : 'Use the button to fill from the phone GPS when you choose.'}</p>
       <button type="button" class="secondary-btn cx-full" data-cx="gps-now">Use current GPS</button>`
    )}
    ${sec(
      'notes',
      'Notes',
      `<div class="field"><label>Notes</label><textarea data-meta="notes">${esc(m.notes)}</textarea></div>`
    )}
    ${sec('photos', `Photos (${record.photos.length})`, photosHtml())}
  `;
}

function photosHtml() {
  const chips = PHOTO_LABELS.map((l) => `<option>${esc(l)}</option>`).join('');
  const list = (record.photos || [])
    .map(
      (p) => `
      <figure class="cx-photo">
        <img src="${esc(p.dataUrl)}" alt="${esc(p.label)}" />
        <figcaption>${esc(p.label === 'Custom' ? p.customLabel || 'Custom' : p.label)}</figcaption>
        <button type="button" class="danger-btn" data-cx="photo-del" data-id="${esc(p.id)}">Remove</button>
      </figure>`
    )
    .join('');
  return `
    <p class="muted">Photos attach to the crossing record (not required on the canvas). Compressed before save.</p>
    ${list || '<p class="muted">No photos yet.</p>'}
    ${
      record.photos.length >= MAX_PHOTOS
        ? `<p class="muted">Maximum ${MAX_PHOTOS} photos (storage limit).</p>`
        : `<div class="field"><label>Photo label</label><select id="cx-photo-label">${chips}</select></div>
           <div class="field" id="cx-photo-custom-wrap" hidden><label>Custom label</label><input id="cx-photo-custom" /></div>
           <label class="primary-btn cx-full cx-file-btn">Add photo
             <input id="cx-photo-file" type="file" accept="image/*" capture="environment" hidden />
           </label>`
    }`;
}

function syncMetaFromPanel() {
  if (!record || !panelOpen) return;
  root.querySelectorAll('[data-meta]').forEach((el) => {
    record.meta[el.dataset.meta] = el.value;
  });
  record.displayName = makeDisplayName(record.meta);
  markDirty();
}

/* ---------- canvas pointers ---------- */

function bindCanvas() {
  const canvas = root.querySelector('#cx-canvas');
  if (!canvas) return;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
}

function canvasPoint(e) {
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, sx: e.clientX, sy: e.clientY };
}

function onPointerDown(e) {
  if (e.button && e.button !== 0) return;
  const canvas = e.currentTarget;
  canvas.setPointerCapture(e.pointerId);
  const pt = canvasPoint(e);
  pointers.set(e.pointerId, pt);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {
      dist: Math.hypot(a.sx - b.sx, a.sy - b.sy),
      cam: { ...camera() },
    };
    drag = null;
    return;
  }

  const cam = camera();
  const wpt = screenToWorld(pt.x, pt.y, cam);

  if (toolMode === 'label') {
    pushUndo();
    const obj = makeObject('label', viewMode, wpt.x, wpt.y);
    record.objects.push(obj);
    selectionId = obj.id;
    setMode('select');
    draw();
    renderSelBar();
    openLabelSheet(obj);
    return;
  }

  if (toolMode === 'ground') {
    groundDraft.push({ x: wpt.x, y: wpt.y });
    draw();
    return;
  }

  if (toolMode === 'measure') {
    measureDraft = { x1: wpt.x, y1: wpt.y, x2: wpt.x, y2: wpt.y };
    drag = { kind: 'measure' };
    draw();
    return;
  }

  const obj = selected();
  if (obj) {
    const h = hitHandle(obj, viewMode, wpt.x, wpt.y, cam);
    if (h) {
      pushUndo();
      drag = {
        kind: 'handle',
        handle: h,
        origin: JSON.parse(JSON.stringify(getGeom(obj, viewMode))),
        id: obj.id,
      };
      return;
    }
  }

  const hit = hitTest(record, viewMode, wpt.x, wpt.y, cam);
  if (hit) {
    selectionId = hit.id;
    renderSelBar();
    draw();
    const h = hitHandle(hit, viewMode, wpt.x, wpt.y, cam) || 'body';
    pushUndo();
    drag = {
      kind: 'handle',
      handle: h === 'a' || h === 'b' || h === 'se' || h?.startsWith?.('p') || h === 'rot' ? h : 'body',
      origin: JSON.parse(JSON.stringify(getGeom(hit, viewMode))),
      id: hit.id,
      last: wpt,
    };
    if (drag.handle === 'body' && getGeom(hit, viewMode)?.type !== 'line') {
      /* point/rect/poly body */
    } else if (drag.handle === 'body' && getGeom(hit, viewMode)?.type === 'line') {
      drag.handle = 'mid';
    }
    return;
  }

  selectionId = null;
  renderSelBar();
  drag = { kind: 'pan', last: pt, cam: { ...cam } };
  draw();
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const pt = canvasPoint(e);
  pointers.set(e.pointerId, pt);

  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
    const cam = camera();
    const scale = Math.max(0.35, Math.min(4, pinch.cam.scale * (dist / (pinch.dist || dist))));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const wx = pinch.cam.x + mx / pinch.cam.scale;
    const wy = pinch.cam.y + my / pinch.cam.scale;
    cam.scale = scale;
    cam.x = wx - mx / scale;
    cam.y = wy - my / scale;
    draw();
    return;
  }

  const cam = camera();
  const wpt = screenToWorld(pt.x, pt.y, cam);

  if (drag?.kind === 'measure' && measureDraft) {
    const snapped = collectSnapTargets(record, viewMode, null);
    measureDraft.x2 = wpt.x;
    measureDraft.y2 = wpt.y;
    void snapped;
    draw();
    return;
  }

  if (drag?.kind === 'handle') {
    const obj = objectById(drag.id);
    if (!obj) return;
    const targets = collectSnapTargets(record, viewMode, obj.id);
    applyHandleDrag(obj, viewMode, drag.handle, wpt.x, wpt.y, drag.origin, cam, targets);
    markDirty();
    draw();
    return;
  }

  if (drag?.kind === 'pan') {
    const dx = (pt.x - drag.last.x) / cam.scale;
    const dy = (pt.y - drag.last.y) / cam.scale;
    cam.x -= dx;
    cam.y -= dy;
    drag.last = pt;
    draw();
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  if (drag?.kind === 'measure' && measureDraft) {
    const dx = measureDraft.x2 - measureDraft.x1;
    const dy = measureDraft.y2 - measureDraft.y1;
    if (Math.hypot(dx, dy) > 12) {
      pushUndo();
      const obj = makeObject('measurement', viewMode, measureDraft.x1, measureDraft.y1);
      obj.geom = { type: 'line', x1: measureDraft.x1, y1: measureDraft.y1, x2: measureDraft.x2, y2: measureDraft.y2 };
      record.objects.push(obj);
      selectionId = obj.id;
      setMode('select');
      measureDraft = null;
      drag = null;
      draw();
      renderSelBar();
      openPropsSheet(obj);
      return;
    }
    measureDraft = null;
  }

  drag = null;
  draw();
}

function onWheel(e) {
  e.preventDefault();
  const cam = camera();
  const pt = canvasPoint(e);
  const factor = e.deltaY < 0 ? 1.08 : 0.92;
  const scale = Math.max(0.35, Math.min(4, cam.scale * factor));
  const wx = cam.x + pt.x / cam.scale;
  const wy = cam.y + pt.y / cam.scale;
  cam.scale = scale;
  cam.x = wx - pt.x / scale;
  cam.y = wy - pt.y / scale;
  draw();
}

function finishGround() {
  if (!groundDraft || groundDraft.length < 2) {
    toast('Need at least two points for ground surface', true);
    return;
  }
  pushUndo();
  const obj = makeObject('ground', viewMode, groundDraft[0].x, groundDraft[0].y);
  obj[viewMode] = { type: 'poly', points: groundDraft.map((p) => ({ x: p.x, y: p.y })) };
  record.objects.push(obj);
  selectionId = obj.id;
  setMode('select');
  draw();
  renderSelBar();
}

/* ---------- save / export / photos ---------- */

function flushDraft() {
  if (record && screen === 'editor') {
    syncMetaFromPanel();
    record.displayName = makeDisplayName(record.meta);
    const ok = saveDraft(record);
    if (!ok) toast('Draft not saved — storage full', true);
  }
}

function startAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(() => {
    if (dirty) flushDraft();
  }, 2500);
}

function stopAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = null;
}

function doSave() {
  if (!record) return;
  syncMetaFromPanel();
  record.displayName = makeDisplayName(record.meta);
  const result = saveCrossing(record);
  if (!result.ok) {
    toast('Could not save — storage full. Remove photos or old crossings.', true);
    return;
  }
  record = result.record;
  savedJson = JSON.stringify(record);
  dirty = false;
  updateSticky();
  toast(`Saved ${record.displayName}`);
}

async function doExport(which, rec = record || exportTarget) {
  if (!rec) return;
  try {
    if (which === 'pdf') await exportPdf(rec);
    else if (which === 'png-plan') await exportPng(rec, 'plan');
    else if (which === 'png-profile') await exportPng(rec, 'profile');
    else if (which === 'jpg-plan') await exportJpg(rec, 'plan');
    else if (which === 'json') exportJson(rec);
    else if (which === 'csv') exportCsv(rec);
    toast('Export started');
  } catch (err) {
    toast(`Export failed: ${err.message || err}`, true);
  }
}

async function addPhoto(file) {
  if (!file) return;
  if (record.photos.length >= MAX_PHOTOS) {
    toast(`Maximum ${MAX_PHOTOS} photos`, true);
    return;
  }
  try {
    const dataUrl = await compressPhoto(file);
    const label = root.querySelector('#cx-photo-label')?.value || 'Pothole';
    const customLabel = root.querySelector('#cx-photo-custom')?.value.trim() || '';
    record.photos.push({
      id: uid(),
      label,
      customLabel,
      dataUrl,
      addedAt: new Date().toISOString(),
    });
    markDirty();
    const result = saveDraft(record);
    if (!result) {
      record.photos.pop();
      toast('Photo too large for device storage', true);
      markDirty();
    }
    renderPanel();
  } catch (err) {
    toast(`Photo failed: ${err.message || err}`, true);
  }
}

function dupSelected() {
  const obj = selected();
  if (!obj) {
    toast('Select an object first');
    return;
  }
  pushUndo();
  const copy = cloneObject(obj);
  record.objects.push(copy);
  selectionId = copy.id;
  draw();
  renderSelBar();
}

function delSelected() {
  const obj = selected();
  if (!obj) {
    toast('Select an object first');
    return;
  }
  if (!window.confirm('Delete selected object?')) return;
  pushUndo();
  record.objects = record.objects.filter((o) => o.id !== obj.id);
  selectionId = null;
  draw();
  renderSelBar();
  renderPanel();
}

function clearCanvas() {
  if (!window.confirm('Clear all drawing objects? Project fields are kept.')) return;
  pushUndo();
  record.objects = [];
  selectionId = null;
  draw();
  renderSelBar();
  renderPanel();
}

/* ---------- clicks ---------- */

function onRootClick(e) {
  const btn = e.target.closest('[data-cx]');
  if (!btn) return;
  const act = btn.dataset.cx;

  if (act === 'new') {
    openCreate();
    return;
  }
  if (act === 'resume-draft') {
    const d = loadDraft();
    if (d) openEditor(d, { isNew: true });
    return;
  }
  if (act === 'discard-draft') {
    if (window.confirm('Discard the unsaved draft?')) {
      clearDraft();
      render();
    }
    return;
  }
  if (act === 'open') {
    const rec = loadCrossing(btn.dataset.id);
    if (rec) openEditor(rec);
    else toast('Could not open that crossing', true);
    return;
  }
  if (act === 'dup') {
    const copy = duplicateCrossing(btn.dataset.id);
    if (copy) {
      toast('Duplicated');
      render();
    } else toast('Duplicate failed', true);
    return;
  }
  if (act === 'del') {
    if (!window.confirm('Delete this crossing sketch? This cannot be undone.')) return;
    deleteCrossing(btn.dataset.id);
    render();
    return;
  }
  if (act === 'export-one') {
    exportTarget = loadCrossing(btn.dataset.id);
    if (!exportTarget) return toast('Could not load crossing', true);
    openSheet(exportSheetHtml());
    return;
  }
  if (act === 'cancel-create') {
    screen = 'library';
    record = null;
    render();
    return;
  }
  if (act === 'start-sketch') {
    record.meta = collectCreateMeta();
    record.displayName = makeDisplayName(record.meta);
    openEditor(record, { isNew: true });
    return;
  }
  if (act === 'view') {
    viewMode = btn.dataset.view === 'profile' ? 'profile' : 'plan';
    root.querySelectorAll('[data-cx="view"]').forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));
    selectionId = null;
    renderSelBar();
    draw();
    return;
  }
  if (act === 'info') {
    panelOpen = !panelOpen;
    const panel = root.querySelector('#cx-panel');
    if (panel) panel.hidden = !panelOpen;
    btn.setAttribute('aria-pressed', String(panelOpen));
    if (panelOpen) renderPanel();
    requestAnimationFrame(resizeCanvas);
    return;
  }
  if (act === 'save') {
    doSave();
    return;
  }
  if (act === 'add') {
    openSheet(addSheetHtml());
    return;
  }
  if (act === 'add-kind') {
    addKind(btn.dataset.kind);
    return;
  }
  if (act === 'measure') {
    closeSheet();
    setMode('measure');
    return;
  }
  if (act === 'label') {
    closeSheet();
    setMode('label');
    return;
  }
  if (act === 'undo') {
    undo();
    return;
  }
  if (act === 'redo') {
    closeSheet();
    redo();
    return;
  }
  if (act === 'more') {
    openSheet(moreSheetHtml());
    return;
  }
  if (act === 'sheet-close') {
    closeSheet();
    return;
  }
  if (act === 'north') {
    addKind('north');
    return;
  }
  if (act === 'arrow') {
    addKind('arrow');
    return;
  }
  if (act === 'dup-obj') {
    closeSheet();
    dupSelected();
    return;
  }
  if (act === 'del-obj') {
    closeSheet();
    delSelected();
    return;
  }
  if (act === 'clear') {
    closeSheet();
    clearCanvas();
    return;
  }
  if (act === 'export-menu') {
    openSheet(exportSheetHtml());
    return;
  }
  if (act === 'photos-jump') {
    closeSheet();
    panelOpen = true;
    openSection = 'photos';
    const panel = root.querySelector('#cx-panel');
    if (panel) panel.hidden = false;
    renderPanel();
    return;
  }
  if (act === 'edit-sel') {
    openPropsSheet(selected());
    return;
  }
  if (act === 'edit-id') {
    const obj = objectById(btn.dataset.id);
    selectionId = obj?.id || null;
    renderSelBar();
    draw();
    openPropsSheet(obj);
    return;
  }
  if (act === 'save-pipe') {
    applyPipelineForm(btn.dataset.id);
    return;
  }
  if (act === 'save-util') {
    applyUtilityForm(btn.dataset.id);
    return;
  }
  if (act === 'save-meas') {
    applyMeasureForm(btn.dataset.id);
    return;
  }
  if (act === 'save-ex') {
    applyExForm(btn.dataset.id);
    return;
  }
  if (act === 'save-label') {
    const obj = objectById(btn.dataset.id);
    if (obj) {
      pushUndo();
      obj.props = { text: val('#pr-text') };
      closeSheet();
      draw();
    }
    return;
  }
  if (act === 'save-simple') {
    const obj = objectById(btn.dataset.id);
    if (obj) {
      pushUndo();
      if (obj.kind === 'label') obj.props = { text: val('#pr-notes') };
      else obj.props = { ...(obj.props || {}), notes: val('#pr-notes') };
      closeSheet();
      draw();
    }
    return;
  }
  if (act === 'ground-done') {
    finishGround();
    return;
  }
  if (act === 'ground-cancel') {
    setMode('select');
    return;
  }
  if (act === 'gps-now') {
    useGps();
    return;
  }
  if (act === 'photo-del') {
    record.photos = record.photos.filter((p) => p.id !== btn.dataset.id);
    markDirty();
    renderPanel();
    return;
  }
  if (act === 'ex-pdf') {
    doExport('pdf');
    return;
  }
  if (act === 'ex-png-plan') {
    doExport('png-plan');
    return;
  }
  if (act === 'ex-png-profile') {
    doExport('png-profile');
    return;
  }
  if (act === 'ex-jpg-plan') {
    doExport('jpg-plan');
    return;
  }
  if (act === 'ex-json') {
    doExport('json');
    return;
  }
  if (act === 'ex-csv') {
    doExport('csv');
    return;
  }
}

async function useGps() {
  toast('Getting GPS…');
  const g = await getGps();
  if (!g) {
    toast('GPS unavailable — enter lat/lon manually', true);
    return;
  }
  record.meta.lat = String(g.lat.toFixed(6));
  record.meta.lon = String(g.lon.toFixed(6));
  record.meta.gpsAccuracy = `${Math.round(g.accuracy || 0)} m`;
  record.meta.gpsSource = 'manual'; // V1: user-initiated fill, not auto-on-create
  markDirty();
  renderPanel();
  toast(fmtGps(g));
}

function onRootChange(e) {
  if (e.target?.id === 'cx-photo-file') {
    addPhoto(e.target.files?.[0]);
    e.target.value = '';
    return;
  }
  if (e.target?.id === 'cx-photo-label') {
    const wrap = root.querySelector('#cx-photo-custom-wrap');
    if (wrap) wrap.hidden = e.target.value !== 'Custom';
    return;
  }
  if (e.target?.hasAttribute?.('data-meta')) {
    syncMetaFromPanel();
  }
  if (e.target?.closest?.('.cx-acc')) {
    const det = e.target.closest('.cx-acc');
    if (det?.dataset.sec) openSection = det.dataset.sec;
  }
}

function onRootToggle(e) {
  const det = e.target.closest?.('.cx-acc');
  if (det?.dataset.sec) openSection = det.open ? det.dataset.sec : '';
}

/* ---------- public ---------- */

export function canLeaveCrossing() {
  if (screen !== 'editor' || !dirty) return true;
  flushDraft();
  return window.confirm('Unsaved crossing edits. A draft is kept on this device. Leave Crossing Sketch?');
}

export function leaveCrossing() {
  flushDraft();
  stopAutosave();
  if (ro) {
    ro.disconnect();
    ro = null;
  }
  window.removeEventListener('resize', resizeCanvas);
}

export function mountCrossing(el) {
  root = el;
  screen = 'library';
  searchQuery = '';
  record = null;
  dirty = false;
  el.innerHTML = '';
  render();
  el.addEventListener('click', onRootClick);
  el.addEventListener('change', onRootChange);
  el.addEventListener('toggle', onRootToggle, true);
  el.addEventListener('input', (e) => {
    if (e.target?.hasAttribute?.('data-meta')) syncMetaFromPanel();
  });

  document.getElementById('crossing-back')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    backFromTool();
  });

  window.addEventListener('beforeunload', (e) => {
    if (screen === 'editor' && dirty) {
      flushDraft();
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/** Used by the node round-trip smoke check. */
export { roundTrip, serializeCrossing, blankCrossing };
