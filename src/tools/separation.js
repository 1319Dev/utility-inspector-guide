/**
 * Separation Check — measured distance vs required clearance presets
 */
const PRESETS = [
  { id: 'ge', label: 'Gas ↔ Electric', inches: 12, note: 'Typical parallel clearance; confirm local / NESC / company' },
  { id: 'gw', label: 'Gas ↔ Water', inches: 12, note: 'Common parallel; crossings may differ' },
  { id: 'gs', label: 'Gas ↔ Sewer', inches: 12, note: 'Common parallel; confirm sanitary codes' },
  { id: 'custom', label: 'Custom', inches: 24, note: 'Enter your required clearance' },
];

export function mountSep(el) {
  el.innerHTML = `
    <p class="muted">Compare measured separation to a required clearance. Presets are typical starting points — verify against your standards.</p>
    <div class="card">
      <div class="field">
        <label>Utility pair</label>
        <select id="sep-preset">
          ${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}
        </select>
      </div>
      <p class="muted" id="sep-note">${PRESETS[0].note}</p>
      <div class="field-row">
        <div class="field"><label>Required (in)</label><input id="sep-req" type="number" inputmode="decimal" value="12" /></div>
        <div class="field"><label>Measured (in)</label><input id="sep-meas" type="number" inputmode="decimal" value="18" /></div>
      </div>
      <button type="button" class="primary-btn" id="sep-check">Check</button>
      <div class="result-box" id="sep-result"><div class="big">—</div></div>
    </div>
  `;

  const sel = el.querySelector('#sep-preset');
  const req = el.querySelector('#sep-req');
  const note = el.querySelector('#sep-note');

  sel.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === sel.value);
    req.value = String(p.inches);
    note.textContent = p.note;
    req.readOnly = p.id !== 'custom';
  });
  req.readOnly = true;

  el.querySelector('#sep-check').addEventListener('click', () => {
    const needed = Number(req.value);
    const measured = Number(el.querySelector('#sep-meas').value);
    const box = el.querySelector('#sep-result');
    if (![needed, measured].every(Number.isFinite)) {
      box.className = 'result-box';
      box.innerHTML = '<div class="big">—</div><div>Invalid</div>';
      return;
    }
    const pass = measured + 1e-6 >= needed;
    box.className = 'result-box ' + (pass ? 'pass' : 'fail');
    box.innerHTML = `
      <div class="big">${pass ? 'PASS' : 'FAIL'}</div>
      <div>Measured ${measured}" vs required ${needed}"</div>
      <div class="muted">Margin ${(measured - needed >= 0 ? '+' : '') + (measured - needed).toFixed(1)}"</div>
    `;
  });
}
