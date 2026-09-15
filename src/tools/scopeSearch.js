/**
 * Scope of Work — upload PDF/TXT/MD/DOCX, search & Q&A excerpts (on-device)
 */
import { formatStamp } from '../store.js';

const DB_NAME = 'uig-scope';
const DB_VER = 1;
const STORE = 'docs';
const DOC_KEY = 'current';
const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB upload
const MAX_TEXT_CHARS = 1_500_000; // ~1.5M chars stored
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 80;
const STOP = new Set(
  'a an the and or but if to of in on for with from by at as is are was were be been being this that these those it its into over under about what which who whom how when where why can could should would will may might must do does did not no yes your my our their i you we they he she them then than so such also just more most other into'.split(
    ' '
  )
);

let root = null;
let doc = null; // { name, kind, uploadedAt, text, chunks }
let pdfReady = null;

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

function chunkText(text) {
  const chunks = [];
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  let idx = 0;
  for (const para of paras) {
    if (para.length <= CHUNK_SIZE) {
      chunks.push({ id: idx++, text: para, heading: guessHeading(para) });
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
      if (piece) chunks.push({ id: idx++, text: piece, heading: guessHeading(piece) });
      if (end >= para.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
  }
  return chunks;
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
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return normalizeText(parts.join('\n\n'));
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
    return { text: await extractPdf(file), kind: 'pdf' };
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

function renderDocMeta() {
  const meta = root.querySelector('#sow-doc-meta');
  const searchCard = root.querySelector('#sow-search-card');
  if (!doc) {
    meta.innerHTML = '<p class="muted">No Scope of Work loaded yet.</p>';
    searchCard.hidden = true;
    root.querySelector('#sow-results').innerHTML = '';
    return;
  }
  const kb = Math.round((doc.text?.length || 0) / 1024);
  meta.innerHTML = `
    <div class="list-item">
      <strong>${escapeHtml(doc.name)}</strong>
      <span class="meta">${escapeHtml(doc.kind || 'file')} · ${doc.chunks.length} sections · ~${kb} KB text · ${escapeHtml(doc.uploadedAt || '')}</span>
      <div class="btn-row">
        <button type="button" class="danger-btn" id="sow-clear">Remove</button>
      </div>
    </div>`;
  searchCard.hidden = false;
  meta.querySelector('#sow-clear')?.addEventListener('click', async () => {
    doc = null;
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
  if (!results.length) {
    box.innerHTML = `<p class="muted">No matching excerpts for “${escapeHtml(q)}”. Try different keywords from the SOW.</p>`;
    return;
  }
  const heading = question ? 'Possible answers from your SOW' : `Matching excerpts (${results.length})`;
  box.innerHTML = `
    <h3>${heading}</h3>
    ${
      question
        ? '<p class="disclaimer muted">Search matches only — not AI advice or a substitute for reading the contract / specs.</p>'
        : ''
    }
    <div class="list">
      ${results
        .map(
          (r) => `
        <div class="list-item sow-hit">
          ${r.heading ? `<strong class="sow-heading">${escapeHtml(r.heading)}</strong>` : '<strong class="sow-heading">Excerpt</strong>'}
          <span class="meta">Relevance ${r.score.toFixed(1)}</span>
          <p class="sow-excerpt">${highlight(r.text, terms || [])}</p>
        </div>`
        )
        .join('')}
    </div>`;
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`File too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB).`, true);
    return;
  }
  setStatus(`Reading ${file.name}…`);
  root.querySelector('#sow-upload-btn').disabled = true;
  try {
    const { text, kind } = await extractFile(file);
    if (!text || text.length < 20) {
      throw new Error('Could not extract usable text from that file.');
    }
    let stored = text;
    let note = '';
    if (stored.length > MAX_TEXT_CHARS) {
      stored = stored.slice(0, MAX_TEXT_CHARS);
      note = ` Truncated to ~${Math.round(MAX_TEXT_CHARS / 1000)}k characters.`;
    }
    const chunks = chunkText(stored);
    doc = {
      name: file.name,
      kind,
      uploadedAt: formatStamp(),
      text: stored,
      chunks,
    };
    try {
      await idbSet(doc);
    } catch (err) {
      console.warn('IndexedDB save failed', err);
      setStatus('Loaded for this session only (storage full or blocked).' + note, true);
      renderDocMeta();
      root.querySelector('#sow-upload-btn').disabled = false;
      return;
    }
    renderDocMeta();
    setStatus(`Ready — ${chunks.length} searchable sections.${note}`);
    const q = root.querySelector('#sow-q');
    if (q.value.trim()) renderResults(q.value);
    else root.querySelector('#sow-results').innerHTML = '<p class="muted">Ask a question or search keywords.</p>';
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
    <p class="muted">Upload your project Scope of Work, then search or ask a question. Text stays on this device (IndexedDB). Educational field aid only.</p>
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
  });

  idbGet().then((saved) => {
    if (saved?.chunks?.length) {
      doc = saved;
      renderDocMeta();
      setStatus('Loaded previous SOW from this device.');
    } else {
      renderDocMeta();
    }
  });
}
