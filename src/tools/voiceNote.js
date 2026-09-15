/**
 * Voice Note — MediaRecorder + optional Web Speech API transcript
 */
import { load, save, uid, formatStamp, getGps, fmtGps, downloadBlob } from '../store.js';

let root, recorder, chunks = [], recognizing = null, interim = '';

function notes() {
  return load('voiceNotes', []);
}

function saveNotes(list) {
  save('voiceNotes', list.slice(0, 40));
}

function renderList() {
  const list = notes();
  const box = root.querySelector('#voice-list');
  if (!list.length) {
    box.innerHTML = '<p class="muted">No saved notes yet.</p>';
    return;
  }
  box.innerHTML = list
    .map(
      (n) => `
      <div class="list-item" data-id="${n.id}">
        <strong>${n.title || 'Voice note'}</strong>
        <span class="meta">${n.when} · ${n.gps || 'GPS n/a'}</span>
        ${n.transcript ? `<p class="muted">${escapeHtml(n.transcript)}</p>` : ''}
        <div class="btn-row">
          ${n.audioDataUrl ? `<a class="secondary-btn" style="text-align:center;line-height:48px;text-decoration:none" download="${n.id}.webm" href="${n.audioDataUrl}">Audio</a>` : ''}
          <button type="button" class="danger-btn voice-del" data-id="${n.id}">Delete</button>
        </div>
      </div>`
    )
    .join('');
  box.querySelectorAll('.voice-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveNotes(notes().filter((n) => n.id !== btn.dataset.id));
      renderList();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function SpeechRec() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function mountVoice(el) {
  root = el;
  root.innerHTML = `
    <p class="muted">Record a finding while your hands are dirty. Uses device mic; speech-to-text when the browser supports it.</p>
    <div class="card">
      <div class="field"><label>Title</label><input id="vn-title" placeholder="e.g. Dent at 3 o'clock" /></div>
      <div class="field"><label>Transcript / notes</label><textarea id="vn-text" placeholder="Spoken or typed notes"></textarea></div>
      <p class="muted" id="vn-status">Idle</p>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="vn-rec">Record</button>
        <button type="button" class="secondary-btn" id="vn-stop" disabled>Stop</button>
        <button type="button" class="secondary-btn" id="vn-save">Save note</button>
      </div>
    </div>
    <div class="card">
      <h3>Recent notes</h3>
      <div id="voice-list" class="list"></div>
    </div>
  `;

  const status = root.querySelector('#vn-status');
  const recBtn = root.querySelector('#vn-rec');
  const stopBtn = root.querySelector('#vn-stop');
  const textEl = root.querySelector('#vn-text');

  recBtn.addEventListener('click', async () => {
    chunks = [];
    interim = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => stream.getTracks().forEach((t) => t.stop());
      recorder.start();
      status.textContent = 'Recording…';
      recBtn.disabled = true;
      stopBtn.disabled = false;

      const SR = SpeechRec();
      if (SR) {
        recognizing = new SR();
        recognizing.continuous = true;
        recognizing.interimResults = true;
        recognizing.onresult = (ev) => {
          let finalText = textEl.value;
          let temp = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const t = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) finalText += (finalText ? ' ' : '') + t;
            else temp += t;
          }
          textEl.value = finalText + (temp ? (finalText ? ' ' : '') + temp : '');
        };
        recognizing.start();
      }
    } catch (err) {
      status.textContent = `Mic error: ${err.message || err}`;
    }
  });

  stopBtn.addEventListener('click', () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (recognizing) {
      try {
        recognizing.stop();
      } catch {}
      recognizing = null;
    }
    status.textContent = 'Stopped — tap Save note';
    recBtn.disabled = false;
    stopBtn.disabled = true;
  });

  root.querySelector('#vn-save').addEventListener('click', async () => {
    const title = root.querySelector('#vn-title').value.trim() || 'Voice note';
    const transcript = textEl.value.trim();
    const g = await getGps();
    let audioDataUrl = null;
    if (chunks.length) {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      audioDataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      // also offer download immediately for large clips
      downloadBlob(`${title.replace(/\W+/g, '_')}-${Date.now()}.webm`, blob);
    }
    const entry = {
      id: uid(),
      title,
      transcript,
      when: formatStamp(),
      gps: fmtGps(g),
      audioDataUrl: audioDataUrl && audioDataUrl.length < 2_500_000 ? audioDataUrl : null,
    };
    saveNotes([entry, ...notes()]);
    chunks = [];
    status.textContent = 'Saved';
    root.querySelector('#vn-title').value = '';
    textEl.value = '';
    renderList();
  });

  renderList();
}
