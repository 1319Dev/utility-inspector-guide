/**
 * Depth of Cover — trench depth / grade-to-top vs min cover
 */
export function mountCover(el) {
  el.innerHTML = `
    <p class="muted">Compute cover over pipe and flag against typical minimums. Confirm company / code requirements — educational only.</p>
    <div class="card">
      <div class="field">
        <label>Input mode</label>
        <div class="segment" id="dc-mode">
          <button type="button" class="active" data-mode="trench">Trench depth to top of pipe</button>
          <button type="button" data-mode="grade">Grade elevation − top of pipe</button>
        </div>
      </div>
      <div class="field-row" id="dc-trench-fields">
        <div class="field"><label>Trench depth (in)</label><input id="dc-depth" type="number" inputmode="decimal" value="36" /></div>
        <div class="field"><label>Pipe OD (in)</label><input id="dc-od" type="number" inputmode="decimal" value="4.5" step="0.1" /></div>
      </div>
      <div class="field-row" id="dc-grade-fields" hidden>
        <div class="field"><label>Finished grade elev</label><input id="dc-grade" type="number" inputmode="decimal" value="100" step="0.01" /></div>
        <div class="field"><label>Top of pipe elev</label><input id="dc-top" type="number" inputmode="decimal" value="97" step="0.01" /></div>
      </div>
      <p class="muted" id="dc-mode-hint">Cover = trench depth to top of pipe (OD not subtracted — enter depth to TOP).</p>
      <div class="field">
        <label>Min cover target</label>
        <div class="segment" id="dc-mins">
          <button type="button" class="active" data-min="24">Gas typ. 24"</button>
          <button type="button" data-min="36">Water typ. 36"</button>
          <button type="button" data-min="custom">Custom</button>
        </div>
      </div>
      <div class="field" id="dc-custom-wrap" hidden>
        <label>Custom min (in)</label>
        <input id="dc-custom" type="number" inputmode="decimal" value="30" />
      </div>
      <button type="button" class="primary-btn" id="dc-calc">Calculate</button>
      <div class="result-box" id="dc-result"><div class="big">—</div><div class="muted">Enter values and calculate</div></div>
      <p class="disclaimer muted">Typical mins vary by jurisdiction, loading, and utility type. Not a substitute for specs.</p>
    </div>
  `;

  let mode = 'trench';
  let minIn = 24;

  el.querySelector('#dc-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    mode = btn.dataset.mode;
    el.querySelectorAll('#dc-mode button').forEach((b) => b.classList.toggle('active', b === btn));
    el.querySelector('#dc-trench-fields').hidden = mode !== 'trench';
    el.querySelector('#dc-grade-fields').hidden = mode !== 'grade';
    el.querySelector('#dc-mode-hint').textContent =
      mode === 'trench'
        ? 'Cover = depth from grade to TOP of pipe (enter that depth directly).'
        : 'Cover (ft) = grade elev − top of pipe elev; shown in inches.';
  });

  el.querySelector('#dc-mins').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-min]');
    if (!btn) return;
    el.querySelectorAll('#dc-mins button').forEach((b) => b.classList.toggle('active', b === btn));
    const v = btn.dataset.min;
    el.querySelector('#dc-custom-wrap').hidden = v !== 'custom';
    if (v !== 'custom') minIn = Number(v);
  });

  el.querySelector('#dc-calc').addEventListener('click', () => {
    if (el.querySelector('#dc-custom-wrap').hidden === false) {
      minIn = Number(el.querySelector('#dc-custom').value) || 0;
    }
    let coverIn;
    if (mode === 'trench') {
      coverIn = Number(el.querySelector('#dc-depth').value);
    } else {
      const grade = Number(el.querySelector('#dc-grade').value);
      const top = Number(el.querySelector('#dc-top').value);
      coverIn = (grade - top) * 12;
    }
    const box = el.querySelector('#dc-result');
    if (!Number.isFinite(coverIn)) {
      box.className = 'result-box';
      box.innerHTML = '<div class="big">—</div><div>Invalid input</div>';
      return;
    }
    const pass = coverIn + 1e-6 >= minIn;
    box.className = 'result-box ' + (pass ? 'pass' : 'fail');
    const ft = coverIn / 12;
    box.innerHTML = `
      <div class="big">${coverIn.toFixed(1)}"</div>
      <div>${ft.toFixed(2)} ft cover</div>
      <div style="margin-top:8px;font-weight:800">${pass ? 'MEETS' : 'BELOW'} min ${minIn}"</div>
      <div class="muted">Δ ${((coverIn - minIn) >= 0 ? '+' : '') + (coverIn - minIn).toFixed(1)}"</div>
    `;
  });
}
