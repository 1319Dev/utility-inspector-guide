/**
 * Depth of Cover — trench depth / grade-to-top vs min cover
 * + two-tap phone altitude / barometer estimate (ft + in)
 */

const SAMPLE_COUNT = 5;
const SAMPLE_GAP_MS = 400;
const M_TO_IN = 39.37007874015748;
const SEA_LEVEL_PA = 101325;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Absolute altitude (m) from pressure via ISA hypsometric approx. */
function pressureToAltitudeM(pa) {
  if (!Number.isFinite(pa) || pa <= 0) return null;
  return 44330.77 * (1 - Math.pow(pa / SEA_LEVEL_PA, 0.190294957));
}

function formatFtIn(meters) {
  if (!Number.isFinite(meters)) return '—';
  const totalIn = meters * M_TO_IN;
  const neg = totalIn < 0;
  const abs = Math.abs(totalIn);
  const ft = Math.floor(abs / 12 + 1e-9);
  const inches = abs - ft * 12;
  const body = `${ft} ft ${inches.toFixed(1)} in`;
  return neg ? `−${body}` : body;
}

function formatMetersShort(m) {
  if (!Number.isFinite(m)) return 'n/a';
  return `${m.toFixed(2)} m`;
}

async function querySensorPermission(name) {
  if (!navigator.permissions?.query) return 'granted';
  try {
    const res = await navigator.permissions.query({ name });
    return res.state;
  } catch {
    return 'granted';
  }
}

/**
 * Collect AbsoluteAltitudeSensor readings (meters). Returns null if unavailable.
 */
async function sampleAbsoluteAltitude(count = SAMPLE_COUNT) {
  if (typeof window.AbsoluteAltitudeSensor === 'undefined') return null;
  const perm = await querySensorPermission('absolute-altitude');
  if (perm === 'denied') return null;

  return new Promise((resolve) => {
    let sensor;
    const readings = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        sensor?.stop();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    try {
      sensor = new window.AbsoluteAltitudeSensor({ frequency: 10 });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      const med = median(readings);
      finish(med == null ? null : { altitudeM: med, method: 'absolute-altitude', accuracyM: null, samples: readings.length });
    }, count * SAMPLE_GAP_MS + 1500);

    sensor.addEventListener('reading', () => {
      if (Number.isFinite(sensor.altitude)) readings.push(sensor.altitude);
      if (readings.length >= count) {
        clearTimeout(timer);
        finish({
          altitudeM: median(readings),
          method: 'absolute-altitude',
          accuracyM: null,
          samples: readings.length,
        });
      }
    });
    sensor.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    try {
      sensor.start();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Collect AmbientPressureSensor readings → altitude (m).
 */
async function sampleBarometerAltitude(count = SAMPLE_COUNT) {
  if (typeof window.AmbientPressureSensor === 'undefined') return null;
  const perm = await querySensorPermission('ambient-pressure');
  if (perm === 'denied') return null;

  return new Promise((resolve) => {
    let sensor;
    const pressures = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        sensor?.stop();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    try {
      sensor = new window.AmbientPressureSensor({ frequency: 10 });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      const medP = median(pressures);
      const alt = pressureToAltitudeM(medP);
      finish(
        alt == null
          ? null
          : { altitudeM: alt, method: 'barometer', accuracyM: null, samples: pressures.length, pressurePa: medP }
      );
    }, count * SAMPLE_GAP_MS + 1500);

    sensor.addEventListener('reading', () => {
      if (Number.isFinite(sensor.pressure)) pressures.push(sensor.pressure);
      if (pressures.length >= count) {
        clearTimeout(timer);
        const medP = median(pressures);
        finish({
          altitudeM: pressureToAltitudeM(medP),
          method: 'barometer',
          accuracyM: null,
          samples: pressures.length,
          pressurePa: medP,
        });
      }
    });
    sensor.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    try {
      sensor.start();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * GPS / GNSS altitude burst via getCurrentPosition.
 */
async function sampleGpsAltitude(count = SAMPLE_COUNT) {
  if (!navigator.geolocation) return null;
  const alts = [];
  const accs = [];

  for (let i = 0; i < count; i++) {
    const sample = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { altitude, altitudeAccuracy } = pos.coords;
          resolve({
            altitude: Number.isFinite(altitude) ? altitude : null,
            accuracy: Number.isFinite(altitudeAccuracy) ? altitudeAccuracy : null,
          });
        },
        () => resolve({ altitude: null, accuracy: null }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
    if (sample.altitude != null) alts.push(sample.altitude);
    if (sample.accuracy != null) accs.push(sample.accuracy);
    if (i < count - 1) await sleep(SAMPLE_GAP_MS);
  }

  const med = median(alts);
  if (med == null) return null;
  return {
    altitudeM: med,
    method: 'gps',
    accuracyM: median(accs),
    samples: alts.length,
  };
}

/** Prefer absolute-altitude → barometer → GPS. */
async function captureAltitudeSample() {
  const abs = await sampleAbsoluteAltitude();
  if (abs?.altitudeM != null) return abs;
  const baro = await sampleBarometerAltitude();
  if (baro?.altitudeM != null) return baro;
  return sampleGpsAltitude();
}

function methodLabel(method) {
  if (method === 'barometer') return 'Barometer';
  if (method === 'absolute-altitude') return 'Absolute altitude sensor';
  if (method === 'gps') return 'GPS / GNSS altitude';
  return 'Unknown';
}

export function mountCover(el) {
  el.innerHTML = `
    <p class="muted">Compute cover over pipe and flag against typical minimums. Confirm company / code requirements — educational only.</p>

    <div class="card">
      <h3>Phone measure (two taps)</h3>
      <p class="muted">1) Lay phone on <strong>top of pipe</strong> → tap <strong>On pipe</strong>. 2) Place phone at <strong>grade</strong> → tap <strong>At grade</strong>. Cover = grade − pipe altitude.</p>
      <div class="btn-row">
        <button type="button" class="primary-btn measure-btn" id="dc-on-pipe">On pipe</button>
        <button type="button" class="primary-btn measure-btn" id="dc-at-grade">At grade</button>
      </div>
      <button type="button" class="secondary-btn" id="dc-reset-meas">Reset measure</button>
      <p class="muted" id="dc-meas-status">Ready — capture On pipe first.</p>
      <div class="result-box" id="dc-meas-result">
        <div class="big">—</div>
        <div class="muted">No phone samples yet</div>
      </div>
      <button type="button" class="secondary-btn" id="dc-use-meas" hidden>Use measured cover in calculator</button>
      <p class="disclaimer muted">Phone GPS/baro vertical error is often several feet. Estimate only — verify with probe rod or tape for compliance.</p>
    </div>

    <div class="card">
      <h3>Manual calculator</h3>
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
  let pipeSample = null;
  let gradeSample = null;
  let lastCoverM = null;
  let capturing = false;

  const statusEl = el.querySelector('#dc-meas-status');
  const measBox = el.querySelector('#dc-meas-result');
  const useBtn = el.querySelector('#dc-use-meas');
  const onPipeBtn = el.querySelector('#dc-on-pipe');
  const atGradeBtn = el.querySelector('#dc-at-grade');

  function setBusy(busy, label) {
    capturing = busy;
    onPipeBtn.disabled = busy;
    atGradeBtn.disabled = busy;
    el.querySelector('#dc-reset-meas').disabled = busy;
    if (busy) statusEl.textContent = label || 'Sampling altitude… hold still';
  }

  function renderMeasure() {
    if (!pipeSample && !gradeSample) {
      measBox.className = 'result-box';
      measBox.innerHTML = `<div class="big">—</div><div class="muted">No phone samples yet</div>`;
      useBtn.hidden = true;
      lastCoverM = null;
      statusEl.textContent = 'Ready — capture On pipe first.';
      return;
    }

    const lines = [];
    if (pipeSample) {
      lines.push(
        `Pipe: ${formatFtIn(pipeSample.altitudeM)} (${formatMetersShort(pipeSample.altitudeM)}) · ${methodLabel(pipeSample.method)}` +
          (pipeSample.accuracyM != null ? ` · ±${pipeSample.accuracyM.toFixed(1)} m` : '') +
          ` · n=${pipeSample.samples}`
      );
    } else {
      lines.push('Pipe: not captured');
    }
    if (gradeSample) {
      lines.push(
        `Grade: ${formatFtIn(gradeSample.altitudeM)} (${formatMetersShort(gradeSample.altitudeM)}) · ${methodLabel(gradeSample.method)}` +
          (gradeSample.accuracyM != null ? ` · ±${gradeSample.accuracyM.toFixed(1)} m` : '') +
          ` · n=${gradeSample.samples}`
      );
    } else {
      lines.push('Grade: not captured');
    }

    if (pipeSample && gradeSample) {
      const coverM = gradeSample.altitudeM - pipeSample.altitudeM;
      lastCoverM = coverM;
      const coverIn = coverM * M_TO_IN;
      const methods =
        pipeSample.method === gradeSample.method
          ? methodLabel(pipeSample.method)
          : `${methodLabel(pipeSample.method)} → ${methodLabel(gradeSample.method)}`;
      const passHint =
        coverIn >= 0
          ? `<div class="muted">${(coverM * 3.280839895).toFixed(2)} ft decimal · method: ${methods}</div>`
          : `<div class="muted">Negative cover — check tap order (pipe then grade) or sensor noise. Method: ${methods}</div>`;

      measBox.className = 'result-box ' + (coverIn >= 0 ? 'pass' : 'fail');
      measBox.innerHTML = `
        <div class="big">${formatFtIn(coverM)}</div>
        <div>Estimated cover</div>
        ${passHint}
        <div class="muted" style="margin-top:8px">${lines.join('<br>')}</div>
      `;
      useBtn.hidden = !(coverIn > 0);
      statusEl.textContent =
        coverIn >= 0
          ? 'Measure complete. Verify with tape/probe for compliance.'
          : 'Unexpected sign — re-capture On pipe then At grade.';
    } else {
      lastCoverM = null;
      measBox.className = 'result-box';
      measBox.innerHTML = `
        <div class="big">…</div>
        <div class="muted">${lines.join('<br>')}</div>
      `;
      useBtn.hidden = true;
      statusEl.textContent = pipeSample ? 'Now place phone at grade and tap At grade.' : 'Ready — capture On pipe first.';
    }
  }

  async function capture(which) {
    if (capturing) return;
    setBusy(true, which === 'pipe' ? 'Sampling on pipe… hold still (~2 s)' : 'Sampling at grade… hold still (~2 s)');
    try {
      const sample = await captureAltitudeSample();
      if (!sample || sample.altitudeM == null) {
        if (which === 'pipe') pipeSample = null;
        else gradeSample = null;
        renderMeasure();
        statusEl.textContent =
          'No altitude available on this device/browser. Use the manual calculator, or try outdoors with GPS / a phone that exposes barometer.';
        return;
      }
      if (which === 'pipe') pipeSample = sample;
      else gradeSample = sample;
      renderMeasure();
    } finally {
      setBusy(false);
      // Status for partial/complete states is set inside renderMeasure / error path.
      if (!pipeSample && !gradeSample) {
        /* keep error or idle message */
      } else if (pipeSample && !gradeSample) {
        statusEl.textContent = 'Pipe captured. Now At grade.';
      } else if (!pipeSample && gradeSample) {
        statusEl.textContent = 'Grade captured. Still need On pipe.';
      }
    }
  }

  onPipeBtn.addEventListener('click', () => capture('pipe'));
  atGradeBtn.addEventListener('click', () => capture('grade'));
  el.querySelector('#dc-reset-meas').addEventListener('click', () => {
    if (capturing) return;
    pipeSample = null;
    gradeSample = null;
    lastCoverM = null;
    renderMeasure();
  });

  useBtn.addEventListener('click', () => {
    if (lastCoverM == null || lastCoverM <= 0) return;
    const coverIn = lastCoverM * M_TO_IN;
    mode = 'trench';
    el.querySelectorAll('#dc-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'trench'));
    el.querySelector('#dc-trench-fields').hidden = false;
    el.querySelector('#dc-grade-fields').hidden = true;
    el.querySelector('#dc-mode-hint').textContent =
      'Cover = depth from grade to TOP of pipe (enter that depth directly).';
    el.querySelector('#dc-depth').value = coverIn.toFixed(1);
    el.querySelector('#dc-calc').click();
    statusEl.textContent = `Copied ${coverIn.toFixed(1)}" into trench depth and calculated.`;
  });

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
    const wholeFt = Math.floor(Math.abs(ft) + 1e-9);
    const remIn = Math.abs(coverIn) - wholeFt * 12;
    const ftInLabel =
      (coverIn < 0 ? '−' : '') + `${wholeFt} ft ${remIn.toFixed(1)} in`;
    box.innerHTML = `
      <div class="big">${coverIn.toFixed(1)}"</div>
      <div>${ftInLabel} · ${ft.toFixed(2)} ft</div>
      <div style="margin-top:8px;font-weight:800">${pass ? 'MEETS' : 'BELOW'} min ${minIn}"</div>
      <div class="muted">Δ ${((coverIn - minIn) >= 0 ? '+' : '') + (coverIn - minIn).toFixed(1)}"</div>
    `;
  });
}
