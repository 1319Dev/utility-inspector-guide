/**
 * Scope of Work — upload PDF/TXT/MD/DOCX, search & open page with highlight
 */
import { formatStamp } from '../store.js';

const DB_NAME = 'uig-scope';
const DB_VER = 2;
const STORE = 'docs';
const DOC_KEY = 'current';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_500_000;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 80;
const STOP = new Set(
  'a an the and or but if to of in on for with from by at as is are was were be been being this that these those it its into over under about what which who whom how when where why can could should would will may might must do does did not no yes your my our their i you we they he she them then than so such also just more most other into'.split(
    ' '
  )
);

let root = null;
/** @type {{ name:string, kind:string, uploadedAt:string, text:string, chunks:any[], pdfBlob?:Blob|null }|null} */
let doc = null;
let pdfReady = null;
let pdfDoc = null; // cached pdf.js document
let lastTerms = [];
let currentPage = 1;
let renderTask = null;
let previewTerms = [];
let previewFocus = '';

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
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(DOC_KEY);
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(q) {
  return String(q)
    .toLowerCase()
    .replace(/[^a-z0-9.%°/"'-]+/gi, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function looksLikeQuestion(q) {
  const s = q.trim().toLowerCase();
  if (s.endsWith('?')) return true;
  return /^(what|when|where|who|whom|whose|why|how|is|are|can|does|do|did|should|will|would|could|may|must|which)\b/.test(
    s
  );
}

function guessHeading(text) {
  const first = text.split('\n')[0].trim();
  if (
    first.length <= 80 &&
    (/^[A-Z0-9 .()\-/]{4,}$/.test(first) || /^\d+(\.\d+)*\s+\S/.test(first))
  ) {
    return first.slice(0, 80);
  }
  return '';
}

function chunkPageText(pageText, pageNum, startId) {
  const chunks = [];
  let idx = startId;
  const paras = pageText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const source = paras.length ? paras : [pageText.trim()].filter(Boolean);

  for (const para of source) {
    if (para.length <= CHUNK_SIZE) {
      chunks.push({ id: idx++, text: para, heading: guessHeading(para), page: pageNum });
      continue;
    }
    let start = 0;
    while (start < para.length) {
      let end = Math.min(start + CHUNK_SIZE, para.length);
      if (end < para.length) {
        const slice = para.slice(start, end);
        const lastBreak = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('\n'),
          slice.lastIndexOf(' ')
        );
        if (lastBreak > CHUNK_SIZE * 0.4) end = start + lastBreak + 1;
      }
      const piece = para.slice(start, end).trim();
      if (piece) chunks.push({ id: idx++, text: piece, heading: guessHeading(piece), page: pageNum });
      if (end >= para.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
  }
  return chunks;
}

function chunkText(text) {
  // Non-PDF: treat whole doc as page 1 sections
  return chunkPageText(text, 1, 0);
}

async function loadPdfjs() {
  if (!pdfReady) {
    pdfReady = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjsLib;
    })();
  }
  return pdfReady;
}

async function extractPdf(file) {
  const pdfjsLib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  // Keep an untouched copy for IndexedDB / preview; pdf.js may detach worker buffers.
  const stored = buf.slice(0);
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const parts = [];
  const chunks = [];
  let nextId = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = normalizeText(
      content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
    );
    parts.push(pageText);
    const pageChunks = chunkPageText(pageText || `(Page ${i} — little extractable text)`, i, nextId);
    nextId += pageChunks.length;
    chunks.push(...pageChunks);
  }
  return {
    text: normalizeText(parts.join('\n\n')),
    chunks,
    pdfBlob: new Blob([stored], { type: 'application/pdf' }),
    pageCount: pdf.numPages,
  };
}

async function extractDocx(file) {
  const mammoth = (await import('mammoth')).default;
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return normalizeText(result.value || '');
}

async function extractPlain(file) {
  return normalizeText(await file.text());
}

async function extractFile(file) {
  const name = file.name || 'document';
  const lower = name.toLowerCase();
  const type = file.type || '';

  if (lower.endsWith('.pdf') || type === 'application/pdf') {
    const r = await extractPdf(file);
    return { text: r.text, kind: 'pdf', chunks: r.chunks, pdfBlob: r.pdfBlob, pageCount: r.pageCount };
  }
  if (
    lower.endsWith('.docx') ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { text: await extractDocx(file), kind: 'docx' };
  }
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    type.startsWith('text/')
  ) {
    return { text: await extractPlain(file), kind: 'text' };
  }
  try {
    const t = await extractPlain(file);
    if (t) return { text: t, kind: 'text' };
  } catch {
    /* fall through */
  }
  throw new Error('Supported formats: PDF, TXT, MD, DOCX');
}

function scoreChunk(chunk, terms) {
  if (!terms.length) return 0;
  const hay = chunk.text.toLowerCase();
  let score = 0;
  let hits = 0;
  for (const t of terms) {
    if (!t) continue;
    let from = 0;
    let count = 0;
    while (from < hay.length) {
      const i = hay.indexOf(t, from);
      if (i < 0) break;
      count++;
      from = i + t.length;
    }
    if (count) {
      hits++;
      score += count * (t.length >= 5 ? 2.5 : 1.5);
      if (chunk.heading && chunk.heading.toLowerCase().includes(t)) score += 3;
    }
  }
  if (!hits) return 0;
  score += (hits / terms.length) * 4;
  score += Math.min(2, 800 / Math.max(chunk.text.length, 1));
  return score;
}

function highlight(text, terms) {
  if (!terms.length) return escapeHtml(text);
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRegExp).join('|')})`, 'gi');
  return escapeHtml(text).replace(pattern, '<mark>$1</mark>');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function search(query, limit = 8) {
  if (!doc || !doc.chunks?.length) return { results: [], question: false, terms: [] };
  const terms = tokenize(query);
  if (!terms.length) return { results: [], question: looksLikeQuestion(query), terms };
  const scored = doc.chunks
    .map((c) => ({ ...c, score: scoreChunk(c, terms) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { results: scored, question: looksLikeQuestion(query), terms };
}

function setStatus(msg, isError = false) {
  const el = root.querySelector('#sow-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

function hideViewer() {
  const viewer = root.querySelector('#sow-viewer');
  if (viewer) viewer.hidden = true;
  if (renderTask) {
    try {
      renderTask.cancel();
    } catch {
      /* ignore */
    }
    renderTask = null;
  }
}

async function pdfBytesFromStored() {
  const raw = doc?.pdfBlob;
  if (!raw) return null;
  if (raw instanceof ArrayBuffer) return raw.slice(0);
  if (ArrayBuffer.isView(raw)) {
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }
  if (typeof raw.arrayBuffer === 'function') {
    const buf = await raw.arrayBuffer();
    return buf.slice(0);
  }
  return null;
}

async function getPdfDocument() {
  if (!doc?.pdfBlob) return null;
  if (pdfDoc) return pdfDoc;
  const pdfjsLib = await loadPdfjs();
  const buf = await pdfBytesFromStored();
  if (!buf || buf.byteLength < 8) {
    throw new Error('PDF data missing — re-upload the file.');
  }
  pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  return pdfDoc;
}

function itemMatchesTerms(str, terms) {
  if (!str || !terms.length) return false;
  const lower = str.toLowerCase();
  return terms.some((t) => t && lower.includes(t));
}

function updatePageNav(pageNum, pageCount) {
  const label = root.querySelector('#sow-viewer-label');
  const prev = root.querySelector('#sow-page-prev');
  const next = root.querySelector('#sow-page-next');
  const nav = root.querySelector('#sow-viewer-nav');
  if (label) label.textContent = `PDF page ${pageNum} / ${pageCount}`;
  if (nav) nav.hidden = false;
  if (prev) prev.disabled = pageNum <= 1;
  if (next) next.disabled = pageNum >= pageCount;
}

/**
 * Render a PDF page and overlay highlight rects for matching text items.
 */
async function openPdfPage(pageNum, terms, focusText) {
  const viewer = root.querySelector('#sow-viewer');
  const canvas = root.querySelector('#sow-pdf-canvas');
  const hl = root.querySelector('#sow-pdf-hl');
  const label = root.querySelector('#sow-viewer-label');
  const textPane = root.querySelector('#sow-text-pane');
  const wrap = root.querySelector('#sow-pdf-wrap');
  if (!viewer || !canvas || !hl || !wrap) return;

  viewer.hidden = false;
  textPane.hidden = true;
  wrap.hidden = false;
  canvas.hidden = false;
  hl.hidden = false;
  currentPage = pageNum;
  previewTerms = terms && terms.length ? [...terms] : [];
  previewFocus = focusText || '';
  if (label) label.textContent = `Loading page ${pageNum}…`;
  viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch {
        /* ignore */
      }
      renderTask = null;
    }

    const pdf = await getPdfDocument();
    if (!pdf) throw new Error('PDF not available — re-upload the file.');
    const total = pdf.numPages || doc.pageCount || 1;
    pageNum = Math.max(1, Math.min(total, pageNum || 1));
    currentPage = pageNum;
    updatePageNav(pageNum, total);

    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const avail = Math.max(280, (wrap.clientWidth || root.clientWidth || 360) - 4);
    const cssWidth = Math.min(avail, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (cssWidth * dpr) / base.width;
    const viewport = page.getViewport({ scale });

    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    hl.width = canvas.width;
    hl.height = canvas.height;
    hl.style.width = canvas.style.width;
    hl.style.height = canvas.style.height;

    const stage = root.querySelector('#sow-pdf-stage');
    if (stage) {
      stage.style.width = canvas.style.width;
    }

    renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    renderTask = null;

    const content = await page.getTextContent();
    const hlCtx = hl.getContext('2d');
    hlCtx.clearRect(0, 0, hl.width, hl.height);
    hlCtx.fillStyle = 'rgba(249, 115, 22, 0.38)';

    const termSet = previewTerms.length ? previewTerms : tokenize(previewFocus || '');
    let firstRect = null;

    function paintItem(item) {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const e = transform[4];
      const f = transform[5];
      const c = transform[2];
      const d = transform[3];
      const pt = viewport.convertToViewportPoint(e, f);
      const fontH = Math.max(8, Math.hypot(c, d) * viewport.scale || Math.abs(d) * viewport.scale);
      const w = Math.max(4, (item.width || 0) * viewport.scale);
      const x = pt[0];
      const y = pt[1] - fontH;
      hlCtx.fillRect(x, y, w, fontH * 1.15);
      if (!firstRect) firstRect = { x: x / dpr, y: y / dpr, w: w / dpr, h: fontH / dpr };
    }

    if (termSet.length) {
      for (const item of content.items) {
        if (!('str' in item) || !item.str?.trim()) continue;
        if (itemMatchesTerms(item.str, termSet)) paintItem(item);
      }
      if (!firstRect && previewFocus) {
        const words = tokenize(previewFocus).slice(0, 16);
        for (const item of content.items) {
          if (!('str' in item) || !item.str?.trim()) continue;
          if (itemMatchesTerms(item.str, words)) paintItem(item);
        }
      }
    }

    if (firstRect) {
      wrap.scrollTop = Math.max(0, firstRect.y - 40);
    } else {
      wrap.scrollTop = 0;
    }
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') return;
    console.error(err);
    if (label) label.textContent = err.message || String(err);
  }
}

async function previewPdf(pageNum = 1, terms = [], focusText = '') {
  if (!(doc?.kind === 'pdf' && doc.pdfBlob)) {
    setStatus('Re-upload the PDF to enable page preview.', true);
    return;
  }
  await openPdfPage(pageNum, terms, focusText);
}

async function shiftPage(delta) {
  if (!doc?.pdfBlob) return;
  const pdf = await getPdfDocument();
  const total = pdf?.numPages || doc.pageCount || 1;
  const next = Math.max(1, Math.min(total, currentPage + delta));
  if (next === currentPage && delta !== 0) return;
  await openPdfPage(next, previewTerms, previewFocus);
}

function openTextHit(chunk, terms) {
  const viewer = root.querySelector('#sow-viewer');
  const canvas = root.querySelector('#sow-pdf-canvas');
  const hl = root.querySelector('#sow-pdf-hl');
  const label = root.querySelector('#sow-viewer-label');
  const textPane = root.querySelector('#sow-text-pane');
  const wrap = root.querySelector('#sow-pdf-wrap');
  const nav = root.querySelector('#sow-viewer-nav');
  if (!viewer) return;

  viewer.hidden = false;
  if (wrap) wrap.hidden = true;
  if (nav) nav.hidden = true;
  if (canvas) canvas.hidden = true;
  if (hl) hl.hidden = true;
  textPane.hidden = false;
  label.textContent = chunk.page ? `Section · page ${chunk.page}` : 'Matching section';
  textPane.innerHTML = `
    ${chunk.heading ? `<h3>${escapeHtml(chunk.heading)}</h3>` : ''}
    <p class="sow-excerpt sow-viewer-excerpt">${highlight(chunk.text, terms)}</p>
  `;
  viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const mark = textPane.querySelector('mark');
  mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function openHit(chunk) {
  lastTerms = lastTerms.length ? lastTerms : tokenize(root.querySelector('#sow-q')?.value || '');
  if (doc?.kind === 'pdf' && doc.pdfBlob && chunk.page) {
    await openPdfPage(chunk.page, lastTerms, chunk.text);
  } else {
    openTextHit(chunk, lastTerms);
  }
}

function renderDocMeta() {
  const meta = root.querySelector('#sow-doc-meta');
  const searchCard = root.querySelector('#sow-search-card');
  if (!doc) {
    meta.innerHTML = '<p class="muted">No Scope of Work loaded yet.</p>';
    searchCard.hidden = true;
    root.querySelector('#sow-results').innerHTML = '';
    hideViewer();
    return;
  }
  const kb = Math.round((doc.text?.length || 0) / 1024);
  const pages =
    doc.kind === 'pdf' && doc.pageCount
      ? ` · ${doc.pageCount} pages`
      : doc.pdfBlob
        ? ' · PDF stored'
        : '';
  meta.innerHTML = `
    <div class="list-item">
      <strong>${escapeHtml(doc.name)}</strong>
      <span class="meta">${escapeHtml(doc.kind || 'file')} · ${doc.chunks.length} sections · ~${kb} KB text${pages} · ${escapeHtml(doc.uploadedAt || '')}</span>
      <div class="btn-row">
        ${
          doc.kind === 'pdf' && doc.pdfBlob
            ? '<button type="button" class="primary-btn" id="sow-preview">Preview document</button>'
            : doc.kind === 'pdf'
              ? ''
              : '<button type="button" class="secondary-btn" id="sow-preview-text">Preview text</button>'
        }
        <button type="button" class="danger-btn" id="sow-clear">Remove</button>
      </div>
    </div>`;
  searchCard.hidden = false;
  meta.querySelector('#sow-preview')?.addEventListener('click', () => {
    previewPdf(1, [], '');
  });
  meta.querySelector('#sow-preview-text')?.addEventListener('click', () => {
    openTextHit(
      { heading: doc.name, text: (doc.text || '').slice(0, 4000), page: 1 },
      []
    );
  });
  meta.querySelector('#sow-clear')?.addEventListener('click', async () => {
    doc = null;
    pdfDoc = null;
    currentPage = 1;
    previewTerms = [];
    previewFocus = '';
    await idbClear();
    renderDocMeta();
    setStatus('Document removed from this device.');
  });
}

function renderResults(query) {
  const box = root.querySelector('#sow-results');
  const q = (query || '').trim();
  if (!doc) {
    box.innerHTML = '';
    return;
  }
  if (!q) {
    box.innerHTML = '<p class="muted">Type keywords or a question above.</p>';
    return;
  }
  const { results, question, terms } = search(q);
  lastTerms = terms;
  if (!results.length) {
    box.innerHTML = `<p class="muted">No matching excerpts for “${escapeHtml(q)}”. Try different keywords from the SOW.</p>`;
    return;
  }
  const heading = question ? 'Possible answers from your SOW' : `Matching excerpts (${results.length})`;
  const canPdf = doc.kind === 'pdf' && !!doc.pdfBlob;
  box.innerHTML = `
    <h3>${heading}</h3>
    ${
      question
        ? '<p class="disclaimer muted">Search matches only — not AI advice or a substitute for reading the contract / specs.</p>'
        : ''
    }
    <p class="muted">Tap a result to open ${canPdf ? 'that PDF page with highlights' : 'the section with highlights'}.</p>
    <div class="list">
      ${results
        .map(
          (r) => `
        <button type="button" class="list-item sow-hit" data-chunk-id="${r.id}">
          ${r.heading ? `<strong class="sow-heading">${escapeHtml(r.heading)}</strong>` : '<strong class="sow-heading">Excerpt</strong>'}
          <span class="meta">Relevance ${r.score.toFixed(1)}${r.page ? ` · page ${r.page}` : ''}</span>
          <p class="sow-excerpt">${highlight(r.text, terms || [])}</p>
        </button>`
        )
        .join('')}
    </div>`;

  box.querySelectorAll('.sow-hit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.chunkId);
      const chunk = results.find((r) => r.id === id) || doc.chunks.find((c) => c.id === id);
      if (chunk) openHit(chunk);
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
  root.querySelector('#sow-upload-btn').disabled = true;
  pdfDoc = null;
  try {
    const extracted = await extractFile(file);
    const text = extracted.text;
    if (!text || text.length < 20) {
      throw new Error('Could not extract usable text from that file.');
    }
    let stored = text;
    let note = '';
    if (stored.length > MAX_TEXT_CHARS) {
      stored = stored.slice(0, MAX_TEXT_CHARS);
      note = ` Truncated to ~${Math.round(MAX_TEXT_CHARS / 1000)}k characters.`;
    }
    const chunks = extracted.chunks?.length ? extracted.chunks : chunkText(stored);
    // If truncated, still keep chunks that fit
    const keepChunks =
      stored.length < text.length
        ? chunks.filter((c) => stored.includes(c.text.slice(0, Math.min(40, c.text.length))))
        : chunks;

    doc = {
      name: file.name,
      kind: extracted.kind,
      uploadedAt: formatStamp(),
      text: stored,
      chunks: keepChunks.length ? keepChunks : chunks,
      pdfBlob: extracted.pdfBlob || null,
      pageCount: extracted.pageCount || null,
    };
    try {
      await idbSet(doc);
    } catch (err) {
      console.warn('IndexedDB save failed', err);
      // retry without pdf blob if quota
      try {
        const slim = { ...doc, pdfBlob: null };
        await idbSet(slim);
        doc.pdfBlob = null;
        note += ' PDF page view not cached (storage limit) — search excerpts still work.';
      } catch {
        setStatus('Loaded for this session only (storage full or blocked).' + note, true);
        renderDocMeta();
        root.querySelector('#sow-upload-btn').disabled = false;
        return;
      }
    }
    renderDocMeta();
    setStatus(`Ready — ${doc.chunks.length} searchable sections.${note}`);
    const q = root.querySelector('#sow-q');
    if (q.value.trim()) renderResults(q.value);
    else root.querySelector('#sow-results').innerHTML = '<p class="muted">Ask a question or search keywords.</p>';
    if (doc.kind === 'pdf' && doc.pdfBlob) {
      // Open page 1 so the document preview is visible immediately after upload
      previewPdf(1, [], '').catch((err) => console.warn('PDF preview failed', err));
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    root.querySelector('#sow-upload-btn').disabled = false;
  }
}

export function mountScope(el) {
  root = el;
  root.innerHTML = `
    <p class="muted">Upload your project Scope of Work to <strong>preview the document</strong>, then search or ask a question. Tap a hit to jump to that <strong>PDF page with highlights</strong>. Stays on this device.</p>
    <div class="card">
      <h3>Upload Scope of Work</h3>
      <label class="sow-drop" id="sow-drop">
        <input type="file" id="sow-file" accept=".pdf,.txt,.md,.markdown,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
        <span class="sow-drop-title">Tap to choose file</span>
        <span class="muted">PDF · TXT · MD · DOCX · max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB</span>
      </label>
      <button type="button" class="primary-btn" id="sow-upload-btn">Choose file</button>
      <p class="muted" id="sow-status"></p>
      <div id="sow-doc-meta"></div>
    </div>
    <div class="card" id="sow-search-card" hidden>
      <h3>Search / ask</h3>
      <div class="field">
        <label for="sow-q">Question or keywords</label>
        <input id="sow-q" type="search" enterkeyhint="search" placeholder="e.g. What is the min cover for gas?" autocomplete="off" />
      </div>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="sow-go">Find in SOW</button>
        <button type="button" class="secondary-btn" id="sow-clear-q">Clear</button>
      </div>
      <div id="sow-results" class="sow-results"></div>
    </div>
    <div class="card sow-viewer" id="sow-viewer" hidden>
      <div class="sow-viewer-bar">
        <strong id="sow-viewer-label">Viewer</strong>
        <div class="sow-viewer-nav" id="sow-viewer-nav" hidden>
          <button type="button" class="secondary-btn" id="sow-page-prev" aria-label="Previous page">‹</button>
          <button type="button" class="secondary-btn" id="sow-page-next" aria-label="Next page">›</button>
        </div>
        <button type="button" class="secondary-btn" id="sow-viewer-close">Close</button>
      </div>
      <div class="sow-pdf-wrap" id="sow-pdf-wrap">
        <div class="sow-pdf-stage" id="sow-pdf-stage">
          <canvas id="sow-pdf-canvas"></canvas>
          <canvas id="sow-pdf-hl" class="sow-pdf-hl"></canvas>
        </div>
      </div>
      <div id="sow-text-pane" class="sow-text-pane" hidden></div>
    </div>
  `;

  const fileInput = root.querySelector('#sow-file');
  const drop = root.querySelector('#sow-drop');
  const openPicker = () => fileInput.click();

  root.querySelector('#sow-upload-btn').addEventListener('click', openPicker);
  drop.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    openPicker();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    handleFile(f);
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
    handleFile(e.dataTransfer?.files?.[0]);
  });

  const run = () => renderResults(root.querySelector('#sow-q').value);
  root.querySelector('#sow-go').addEventListener('click', run);
  root.querySelector('#sow-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
  root.querySelector('#sow-clear-q').addEventListener('click', () => {
    root.querySelector('#sow-q').value = '';
    root.querySelector('#sow-results').innerHTML = '<p class="muted">Ask a question or search keywords.</p>';
    hideViewer();
  });
  root.querySelector('#sow-viewer-close').addEventListener('click', hideViewer);
  root.querySelector('#sow-page-prev')?.addEventListener('click', () => shiftPage(-1));
  root.querySelector('#sow-page-next')?.addEventListener('click', () => shiftPage(1));

  idbGet().then((saved) => {
    if (saved?.chunks?.length) {
      doc = saved;
      pdfDoc = null;
      renderDocMeta();
      const note =
        saved.kind === 'pdf' && !saved.pdfBlob
          ? ' Loaded text search (re-upload PDF to enable page highlights).'
          : ' Loaded previous SOW from this device.';
      setStatus(note.trim());
    } else {
      renderDocMeta();
    }
  });
}
