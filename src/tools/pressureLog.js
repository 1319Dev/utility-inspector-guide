/**
 * Pressure / Soap Test Log — entries + CSV/JSON export
 */
import { load, save, uid, formatStamp, downloadText, loadSettings } from '../store.js';

function logs() {
  return load('pressureLogs', []);
}

function saveLogs(list) {
  save('pressureLogs', list.slice(0, 100));
}

export function mountPressure(el) {
  const s = loadSettings();
  el.innerHTML = `
    <p class="muted">Log pressure / soap tests with pass-fail. Data stays on device; export CSV or JSON.</p>
    <div class="card">
      <div class="field"><label>Job / segment</label><input id="pr-job" placeholder="Main / service ID" /></div>
      <div class="field-row">
        <div class="field"><label>Pressure</label><input id="pr-psi" type="number" inputmode="decimal" placeholder="psig" /></div>
        <div class="field"><label>Hold (min)</label><input id="pr-hold" type="number" inputmode="decimal" value="15" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Start reading</label><input id="pr-start" type="number" inputmode="decimal" /></div>
        <div class="field"><label>End reading</label><input id="pr-end" type="number" inputmode="decimal" /></div>
      </div>
      <div class="field"><label>Result</label>
        <div class="segment" id="pr-result">
          <button type="button" class="active" data-r="PASS">PASS</button>
          <button type="button" data-r="FAIL">FAIL</button>
        </div>
      </div>
      <div class="field"><label>Tester</label><input id="pr-who" value="${(s.inspectorName || '').replace(/"/g,'&quot;')}" /></div>
      <div class="field"><label>Notes / gauge photo reminder</label><textarea id="pr-notes" placeholder="Soap test locations, gauge photo taken, etc."></textarea></div>
      <button type="button" class="primary-btn" id="pr-add">Add entry</button>
    </div>
    <div class="card">
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="pr-csv">Export CSV</button>
        <button type="button" class="secondary-btn" id="pr-json">Export JSON</button>
      </div>
      <div id="pr-list" class="list"></div>
    </div>
  `;

  let result = 'PASS';
  el.querySelector('#pr-result').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    result = btn.dataset.r;
    el.querySelectorAll('#pr-result button').forEach((b) => b.classList.toggle('active', b === btn));
  });

  const render = () => {
    const list = logs();
    const box = el.querySelector('#pr-list');
    if (!list.length) {
      box.innerHTML = '<p class="muted">No entries yet.</p>';
      return;
    }
    box.innerHTML = list
      .map(
        (n) => `
        <div class="list-item">
          <strong>${n.result} · ${n.psi || '—'} psig · ${n.hold || '—'} min</strong>
          <span class="meta">${n.when} · ${n.job || '—'}</span>
          <span class="meta">Start ${n.start ?? '—'} → End ${n.end ?? '—'} · ${n.who || ''}</span>
          ${n.notes ? `<p class="muted">${n.notes}</p>` : ''}
          <button type="button" class="danger-btn pr-del" data-id="${n.id}">Delete</button>
        </div>`
      )
      .join('');
    box.querySelectorAll('.pr-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        saveLogs(logs().filter((x) => x.id !== btn.dataset.id));
        render();
      });
    });
  };

  el.querySelector('#pr-add').addEventListener('click', () => {
    const entry = {
      id: uid(),
      when: formatStamp(),
      job: el.querySelector('#pr-job').value.trim(),
      psi: el.querySelector('#pr-psi').value,
      hold: el.querySelector('#pr-hold').value,
      start: el.querySelector('#pr-start').value,
      end: el.querySelector('#pr-end').value,
      result,
      who: el.querySelector('#pr-who').value.trim(),
      notes: el.querySelector('#pr-notes').value.trim(),
    };
    saveLogs([entry, ...logs()]);
    el.querySelector('#pr-notes').value = '';
    render();
  });

  el.querySelector('#pr-csv').addEventListener('click', () => {
    const rows = [['when','job','psi','hold_min','start','end','result','who','notes']];
    logs().forEach((n) => {
      rows.push([n.when, n.job, n.psi, n.hold, n.start, n.end, n.result, n.who, (n.notes || '').replace(/\n/g, ' ')]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadText(`pressure-log-${Date.now()}.csv`, csv, 'text/csv');
  });

  el.querySelector('#pr-json').addEventListener('click', () => {
    downloadText(`pressure-log-${Date.now()}.json`, JSON.stringify(logs(), null, 2), 'application/json');
  });

  render();
}
