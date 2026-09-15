/**
 * Daily Progress Report — digital form matching company PDF template
 */
import {
  load,
  save,
  loadSettings,
  saveSettings,
  downloadText,
  formatStamp,
  uid,
} from '../store.js';

export const PHASES = [
  'Right-of-Way Clearing',
  'Right-of-Way Grading',
  'Pipe Stringing',
  'Bend or Lay',
  'Steel Welding or Poly Fusing',
  'Casing and Crossings',
  'Coating and/or Field Joints',
  'Ditching Depth and Condition',
  'Holiday Detection',
  'Pipe Lowered In Ditch',
  'Pipe Cleaning and Pigging',
  'Tie-in',
  'Pipe Backfill',
  'Pressure Testing',
  'Tapping and Loading of Line',
  'Purging Operations',
  'Final Backfill and Clean-up',
];

const HISTORY_KEY = 'dailyReports';
const DRAFT_KEY = 'dailyReportDraft';
const TEMPLATE_KEY = 'dailyReportTemplateName';
const MAX_HISTORY = 60;

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function emptyPhase() {
  return { from: '', to: '', today: '', previous: '', total: '', pct: '', jobTotal: '' };
}

function blankReport() {
  const phases = {};
  for (const p of PHASES) phases[p] = emptyPhase();
  return {
    id: uid(),
    date: todayISO(),
    inspector: '',
    contractor: '',
    projectNo: '',
    phases,
    comments: '',
    signature: '',
    mileage: '',
    arrival: '',
    departure: '',
    hours: '',
    savedAt: null,
  };
}

function history() {
  return load(HISTORY_KEY, []);
}

function saveHistory(list) {
  save(HISTORY_KEY, list.slice(0, MAX_HISTORY));
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcPhase(ph) {
  const t = num(ph.today);
  const p = num(ph.previous);
  let total = ph.total;
  if (t != null || p != null) {
    total = String((t || 0) + (p || 0));
  }
  let pct = ph.pct;
  const job = num(ph.jobTotal);
  const tot = num(total);
  if (job != null && job > 0 && tot != null) {
    pct = String(Math.round((tot / job) * 1000) / 10);
  }
  return { ...ph, total: total ?? '', pct: pct ?? '' };
}

function hoursFromTimes(arrival, departure) {
  if (!arrival || !departure) return null;
  const [ah, am] = arrival.split(':').map(Number);
  const [dh, dm] = departure.split(':').map(Number);
  if (![ah, am, dh, dm].every((x) => Number.isFinite(x))) return null;
  let mins = dh * 60 + dm - (ah * 60 + am);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function collect(root) {
  const phases = {};
  for (const name of PHASES) {
    const id = phaseId(name);
    const raw = {
      from: root.querySelector(`#${id}-from`)?.value.trim() || '',
      to: root.querySelector(`#${id}-to`)?.value.trim() || '',
      today: root.querySelector(`#${id}-today`)?.value.trim() || '',
      previous: root.querySelector(`#${id}-prev`)?.value.trim() || '',
      total: root.querySelector(`#${id}-total`)?.value.trim() || '',
      pct: root.querySelector(`#${id}-pct`)?.value.trim() || '',
      jobTotal: root.querySelector(`#${id}-job`)?.value.trim() || '',
    };
    phases[name] = calcPhase(raw);
  }
  const arrival = root.querySelector('#dr-arrival').value;
  const departure = root.querySelector('#dr-departure').value;
  let hours = root.querySelector('#dr-hours').value.trim();
  const auto = hoursFromTimes(arrival, departure);
  if (auto != null && !hours) hours = String(auto);

  return {
    id: root.dataset.reportId || uid(),
    date: root.querySelector('#dr-date').value || todayISO(),
    inspector: root.querySelector('#dr-inspector').value.trim(),
    contractor: root.querySelector('#dr-contractor').value.trim(),
    projectNo: root.querySelector('#dr-project').value.trim(),
    phases,
    comments: root.querySelector('#dr-comments').value.trim(),
    signature: root.querySelector('#dr-sign').value.trim(),
    mileage: root.querySelector('#dr-mileage').value.trim(),
    arrival,
    departure,
    hours,
    savedAt: formatStamp(),
  };
}

function phaseId(name) {
  return 'ph-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function phaseHasData(ph) {
  return !!(ph.from || ph.to || ph.today || ph.previous || ph.total || ph.pct || ph.jobTotal);
}

function toText(report) {
  const lines = [
    'DAILY PROGRESS REPORT',
    `Date: ${report.date}`,
    `Inspector: ${report.inspector || '—'}`,
    `Contractor: ${report.contractor || '—'}`,
    `Project No: ${report.projectNo || '—'}`,
    '',
    'PHASE OF CONSTRUCTION',
  ];
  for (const name of PHASES) {
    const ph = report.phases[name] || emptyPhase();
    if (!phaseHasData(ph)) continue;
    lines.push(
      `${name}`,
      `  Station: ${ph.from || '—'} → ${ph.to || '—'}`,
      `  Today: ${ph.today || '—'}  Previous: ${ph.previous || '—'}  Total: ${ph.total || '—'}  %: ${ph.pct || '—'}`,
    );
  }
  lines.push(
    '',
    `Comments: ${report.comments || '—'}`,
    '',
    `Signature of Inspector: ${report.signature || report.inspector || '—'}`,
    `Mileage: ${report.mileage || '—'}`,
    `Arrival: ${report.arrival || '—'}`,
    `Departure: ${report.departure || '—'}`,
    `Total Inspection Hours Today: ${report.hours || '—'}`,
    '',
    `Exported: ${formatStamp()}`,
    'Utility Inspector Guide — field reference / filled digital form.',
  );
  return lines.join('\n');
}

function toPrintableHtml(report) {
  const rows = PHASES.map((name) => {
    const ph = report.phases[name] || emptyPhase();
    return `<tr>
      <td class="phase">${esc(name)}</td>
      <td>${esc(ph.from)}</td>
      <td>${esc(ph.to)}</td>
      <td>${esc(ph.today)}</td>
      <td>${esc(ph.previous)}</td>
      <td>${esc(ph.total)}</td>
      <td>${esc(ph.pct)}${ph.pct !== '' ? '%' : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Daily Progress Report — ${esc(report.date)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;color:#0f172a;font-size:12px}
  h1{font-size:18px;margin:0 0 12px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:14px}
  .meta div{border-bottom:1px solid #cbd5e1;padding:4px 0}
  .meta strong{display:inline-block;min-width:90px;color:#475569}
  table{width:100%;border-collapse:collapse;margin:10px 0}
  th,td{border:1px solid #94a3b8;padding:5px 6px;vertical-align:top}
  th{background:#e2e8f0;text-align:left;font-size:11px}
  td.phase{font-weight:600;width:28%}
  .comments{min-height:60px;border:1px solid #94a3b8;padding:8px;margin:10px 0;white-space:pre-wrap}
  .foot{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-top:12px}
  .muted{color:#64748b;font-size:11px;margin-top:16px}
  @media print{body{margin:12px} .noprint{display:none}}
</style></head><body>
  <button class="noprint" onclick="window.print()" style="margin-bottom:12px;padding:8px 14px;font-weight:700">Print</button>
  <h1>Daily Progress Report</h1>
  <div class="meta">
    <div><strong>Date</strong> ${esc(report.date)}</div>
    <div><strong>Project No</strong> ${esc(report.projectNo)}</div>
    <div><strong>Inspector</strong> ${esc(report.inspector)}</div>
    <div><strong>Contractor</strong> ${esc(report.contractor)}</div>
  </div>
  <table>
    <thead><tr>
      <th>Phase of Construction</th><th>Station From</th><th>To</th>
      <th>Footage Today</th><th>Previous</th><th>Total</th><th>%</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div><strong>Comments</strong></div>
  <div class="comments">${esc(report.comments) || '&nbsp;'}</div>
  <div class="foot">
    <div><strong>Signature of Inspector</strong><br/>${esc(report.signature || report.inspector)}</div>
    <div><strong>Mileage</strong><br/>${esc(report.mileage)}</div>
    <div><strong>Arrival Time</strong><br/>${esc(report.arrival)}</div>
    <div><strong>Departure Time</strong><br/>${esc(report.departure)}</div>
    <div><strong>Total Inspection Hours Today</strong><br/>${esc(report.hours)}</div>
  </div>
  <p class="muted">Generated by Utility Inspector Guide · educational/field use · ${esc(formatStamp())}</p>
</body></html>`;
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function applyPhaseCalcs(root) {
  for (const name of PHASES) {
    const id = phaseId(name);
    const todayEl = root.querySelector(`#${id}-today`);
    const prevEl = root.querySelector(`#${id}-prev`);
    const totalEl = root.querySelector(`#${id}-total`);
    const pctEl = root.querySelector(`#${id}-pct`);
    const jobEl = root.querySelector(`#${id}-job`);
    if (!todayEl) continue;
    const next = calcPhase({
      today: todayEl.value,
      previous: prevEl.value,
      total: totalEl.value,
      pct: pctEl.value,
      jobTotal: jobEl.value,
      from: '',
      to: '',
    });
    // Only overwrite total when today or previous provided
    if (todayEl.value !== '' || prevEl.value !== '') {
      totalEl.value = next.total;
    }
    if (jobEl.value !== '' && num(jobEl.value) > 0 && (todayEl.value !== '' || prevEl.value !== '' || totalEl.value !== '')) {
      pctEl.value = next.pct;
    }
  }
  const arrival = root.querySelector('#dr-arrival').value;
  const departure = root.querySelector('#dr-departure').value;
  const hoursEl = root.querySelector('#dr-hours');
  const auto = hoursFromTimes(arrival, departure);
  if (auto != null) hoursEl.value = String(auto);
}

function renderPhaseCards(phases) {
  return PHASES.map((name) => {
    const id = phaseId(name);
    const ph = phases[name] || emptyPhase();
    const open = phaseHasData(ph) ? 'open' : '';
    return `
      <details class="dr-phase" ${open}>
        <summary>${esc(name)}</summary>
        <div class="dr-phase-body">
          <div class="field-row">
            <div class="field"><label>Station From</label><input id="${id}-from" inputmode="decimal" value="${esc(ph.from)}" /></div>
            <div class="field"><label>To</label><input id="${id}-to" inputmode="decimal" value="${esc(ph.to)}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Footage Today</label><input id="${id}-today" type="number" inputmode="decimal" step="any" value="${esc(ph.today)}" /></div>
            <div class="field"><label>Previous</label><input id="${id}-prev" type="number" inputmode="decimal" step="any" value="${esc(ph.previous)}" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Total (auto)</label><input id="${id}-total" type="number" inputmode="decimal" step="any" value="${esc(ph.total)}" /></div>
            <div class="field"><label>% Completed</label><input id="${id}-pct" type="number" inputmode="decimal" step="any" value="${esc(ph.pct)}" /></div>
          </div>
          <div class="field"><label>Job total footage (optional → auto %)</label><input id="${id}-job" type="number" inputmode="decimal" step="any" value="${esc(ph.jobTotal)}" placeholder="e.g. planned feet for this phase" /></div>
        </div>
      </details>`;
  }).join('');
}

function renderHistoryList(root) {
  const box = root.querySelector('#dr-history');
  const list = history();
  if (!list.length) {
    box.innerHTML = '<p class="muted">No saved reports yet.</p>';
    return;
  }
  box.innerHTML = list
    .map(
      (r) => `
      <div class="list-item" data-id="${esc(r.id)}">
        <strong>${esc(r.date)}</strong>
        <span class="meta">${esc(r.projectNo || 'No project #')} · ${esc(r.inspector || '—')} · ${esc(r.savedAt || '')}</span>
        <div class="btn-row">
          <button type="button" class="secondary-btn dr-load" data-id="${esc(r.id)}">Load</button>
          <button type="button" class="danger-btn dr-del" data-id="${esc(r.id)}">Delete</button>
        </div>
      </div>`
    )
    .join('');

  box.querySelectorAll('.dr-load').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = history().find((x) => x.id === btn.dataset.id);
      if (!r) return;
      save(DRAFT_KEY, r);
      mountDaily(root, r);
    });
  });
  box.querySelectorAll('.dr-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveHistory(history().filter((x) => x.id !== btn.dataset.id));
      renderHistoryList(root);
    });
  });
}

export function mountDaily(el, preload = null) {
  const s = loadSettings();
  const draft = preload || load(DRAFT_KEY, null) || blankReport();
  if (!draft.inspector) draft.inspector = s.inspectorName || '';
  if (!draft.signature) draft.signature = draft.inspector || s.inspectorName || '';
  if (!draft.date) draft.date = todayISO();
  if (!draft.phases) {
    draft.phases = {};
    for (const p of PHASES) draft.phases[p] = emptyPhase();
  }
  for (const p of PHASES) {
    if (!draft.phases[p]) draft.phases[p] = emptyPhase();
  }

  const customTpl = load(TEMPLATE_KEY, '');

  el.dataset.reportId = draft.id || uid();
  el.innerHTML = `
    <p class="muted">Fill the daily progress report on your phone. Totals and hours auto-calc. Matches your company form layout — export to share or print. Not a signed legal original.</p>
    <div class="card">
      <h3>Header</h3>
      <div class="field-row">
        <div class="field"><label>Date</label><input id="dr-date" type="date" value="${esc(draft.date)}" /></div>
        <div class="field"><label>Project No</label><input id="dr-project" value="${esc(draft.projectNo)}" /></div>
      </div>
      <div class="field"><label>Inspector</label><input id="dr-inspector" value="${esc(draft.inspector)}" autocomplete="name" /></div>
      <div class="field"><label>Contractor</label><input id="dr-contractor" value="${esc(draft.contractor)}" /></div>
    </div>

    <div class="card">
      <h3>Phase of Construction</h3>
      <p class="muted">Expand a phase to enter station &amp; footage. Total = Today + Previous. Optional job total auto-fills %.</p>
      <div class="dr-phases">${renderPhaseCards(draft.phases)}</div>
    </div>

    <div class="card">
      <h3>Comments</h3>
      <div class="field"><textarea id="dr-comments" rows="4" placeholder="Notes for today">${esc(draft.comments)}</textarea></div>
    </div>

    <div class="card">
      <h3>Footer</h3>
      <div class="field"><label>Signature of Inspector (name)</label><input id="dr-sign" value="${esc(draft.signature)}" /></div>
      <div class="field-row">
        <div class="field"><label>Mileage</label><input id="dr-mileage" inputmode="decimal" value="${esc(draft.mileage)}" /></div>
        <div class="field"><label>Hours today</label><input id="dr-hours" type="number" inputmode="decimal" step="0.01" value="${esc(draft.hours)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Arrival</label><input id="dr-arrival" type="time" value="${esc(draft.arrival)}" /></div>
        <div class="field"><label>Departure</label><input id="dr-departure" type="time" value="${esc(draft.departure)}" /></div>
      </div>
      <p class="muted">Hours auto-fill from arrival → departure when you leave Hours blank or change times.</p>
    </div>

    <div class="card">
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="dr-save">Save draft</button>
        <button type="button" class="primary-btn" id="dr-export-html">Export HTML</button>
      </div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="dr-export-txt">Export text</button>
        <button type="button" class="secondary-btn" id="dr-new">New day</button>
      </div>
      <p class="muted" id="dr-status"></p>
    </div>

    <div class="card">
      <h3>Company PDF template</h3>
      <a class="secondary-btn dr-link-btn" href="./templates/daily-progress-report.pdf" target="_blank" rel="noopener">Open blank company PDF</a>
      <div class="field" style="margin-top:12px">
        <label>Optional: note your own blank PDF name (reference only)</label>
        <input id="dr-tpl-name" value="${esc(customTpl)}" placeholder="e.g. ACME-daily-progress.pdf" />
      </div>
      <button type="button" class="secondary-btn" id="dr-tpl-save">Save template note</button>
      <p class="muted">Phone form is the primary fill path; the PDF is for company blank / print reference.</p>
    </div>

    <div class="card">
      <h3>Saved reports</h3>
      <div id="dr-history" class="list"></div>
    </div>
  `;

  const status = (msg) => {
    el.querySelector('#dr-status').textContent = msg || '';
  };

  const persistDraft = () => {
    applyPhaseCalcs(el);
    const data = collect(el);
    el.dataset.reportId = data.id;
    save(DRAFT_KEY, data);
    if (data.inspector) saveSettings({ inspectorName: data.inspector });
    return data;
  };

  el.addEventListener('change', (e) => {
    if (e.target.closest('.dr-phase') || e.target.id === 'dr-arrival' || e.target.id === 'dr-departure') {
      applyPhaseCalcs(el);
    }
  });
  el.addEventListener('input', (e) => {
    if (
      e.target.id?.endsWith('-today') ||
      e.target.id?.endsWith('-prev') ||
      e.target.id?.endsWith('-job') ||
      e.target.id === 'dr-arrival' ||
      e.target.id === 'dr-departure'
    ) {
      applyPhaseCalcs(el);
    }
  });

  el.querySelector('#dr-save').addEventListener('click', () => {
    const data = persistDraft();
    const list = history().filter((x) => x.id !== data.id && !(x.date === data.date && x.projectNo === data.projectNo));
    saveHistory([data, ...list]);
    renderHistoryList(el);
    status(`Saved ${data.date} on this device.`);
  });

  el.querySelector('#dr-export-html').addEventListener('click', () => {
    const data = persistDraft();
    downloadHtml(`daily-progress-${data.date}.html`, toPrintableHtml(data));
    status('Downloaded printable HTML.');
  });

  el.querySelector('#dr-export-txt').addEventListener('click', async () => {
    const data = persistDraft();
    const text = toText(data);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Daily Progress ${data.date}`, text });
        status('Shared.');
        return;
      } catch {}
    }
    downloadText(`daily-progress-${data.date}.txt`, text);
    status('Downloaded text export.');
  });

  el.querySelector('#dr-new').addEventListener('click', () => {
    const next = blankReport();
    next.inspector = el.querySelector('#dr-inspector').value.trim() || loadSettings().inspectorName || '';
    next.contractor = el.querySelector('#dr-contractor').value.trim();
    next.projectNo = el.querySelector('#dr-project').value.trim();
    next.signature = next.inspector;
    save(DRAFT_KEY, next);
    mountDaily(el, next);
  });

  el.querySelector('#dr-tpl-save').addEventListener('click', () => {
    save(TEMPLATE_KEY, el.querySelector('#dr-tpl-name').value.trim());
    status('Template note saved.');
  });

  renderHistoryList(el);
}
