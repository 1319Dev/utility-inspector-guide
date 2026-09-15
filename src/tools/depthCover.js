/**
 * Depth of Cover — trench depth / grade-to-top vs min cover
 * + two-tap phone measure (relative baro preferred) + probe/tape entry
 */

const SAMPLE_COUNT = 6;
const SAMPLE_GAP_MS = 350;
const M_TO_IN = 39.37007874015748;
const M_TO_FT = 3.280839895;
const SEA_LEVEL_PA = 101325;
/** Reject cover if |delta| below this without good relative pressure (noise floor). */
const MIN_TRUST_M = 0.05; // ~2 in
const SAME_READING_M = 0.02; // ~0.8 in — treat as identical

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function pressureToAltitudeM(pa) {
  if (!Number.isFinite(pa) || pa <= 0) return null;
  return 44330.77 * (1 - Math.pow(pa / SEA_LEVEL_PA, 0.190294957));
}

/** Relative height (m) from two pressures — more stable than absolute ISA for short taps. */
function relativeHeightFromPressure(pLow, pHigh) {
  // Positive when pLow is lower pressure (higher altitude)? 
  // Pipe is deeper → higher pressure than grade.
  // cover ≈ height of grade above pipe → pressure_pipe > pressure_grade
  // Δh_grade_above_pipe = alt(P_grade) - alt(P_pipe) using same ISA, OR:
  if (!Number.isFinite(pLow) || !Number.isFinite(pHigh) || pLow <= 0 || pHigh <= 0) return null;
  // Isothermal approx near surface: h2-h1 = (RT/gM) ln(P1/P2); use 288.15 K
  // Here we want grade altitude - pipe altitude with P_grade and P_pipe:
  // h_grade - h_pipe = k * ln(P_pipe / P_grade)
  const T = 288.15;
  const k = (287.05 * T) / 9.80665; // ≈ 8433 m
  return k * Math.log(pHigh / pLow);
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

function parseFtIn(ftStr, inStr) {
  const ft = Number(ftStr);
  const inches = Number(inStr);
  const f = Number.isFinite(ft) ? ft : 0;
  const i = Number.isFinite(inches) ? inches : 0;
  return (f * 12 + i) / M_TO_IN; // meters
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
      finish(
        med == null
          ? null
          : { altitudeM: med, method: 'absolute-altitude', accuracyM: null, samples: readings.length }
      );
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

async function sampleBarometer(count = SAMPLE_COUNT) {
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
        medP == null
          ? null
          : {
              altitudeM: alt,
              pressurePa: medP,
              method: 'barometer',
              accuracyM: 0.5,
              samples: pressures.length,
            }
      );
    }, count * SAMPLE_GAP_MS + 1500);

    sensor.addEventListener('reading', () => {
      if (Number.isFinite(sensor.pressure) && sensor.pressure > 0) pressures.push(sensor.pressure);
      if (pressures.length >= count) {
        clearTimeout(timer);
        const medP = median(pressures);
        finish({
          altitudeM: pressureToAltitudeM(medP),
          pressurePa: medP,
          method: 'barometer',
          accuracyM: 0.5,
          samples: pressures.length,
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
            // Many phones report altitude 0 or null when unknown — treat 0 with no accuracy as missing
            altitude:
              Number.isFinite(altitude) && !(altitude === 0 && altitudeAccuracy == null)
                ? altitude
                : null,
            accuracy: Number.isFinite(altitudeAccuracy) ? altitudeAccuracy : null,
          });
        },
        () => resolve({ altitude: null, accuracy: null }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
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

/** Prefer barometer (keeps pressurePa) → absolute-altitude → GPS. */
async function captureAltitudeSample() {
  const baro = await sampleBarometer();
  if (baro?.pressurePa != null || baro?.altitudeM != null) return baro;
  const abs = await sampleAbsoluteAltitude();
  if (abs?.altitudeM != null) return abs;
  return sampleGpsAltitude();
}

function methodLabel(method) {
  if (method === 'barometer') return 'Barometer (relative)';
  if (method === 'absolute-altitude') return 'Absolute altitude sensor';
  if (method === 'gps') return 'GPS / GNSS altitude';
  if (method === 'probe') return 'Probe / tape';
  return 'Unknown';
}

/**
 * Compute cover meters from two samples. Prefers relative pressure when both have pressurePa.
 * Returns { coverM, ok, reason, method }.
 */
function computeCover(pipeSample, gradeSample) {
  if (!pipeSample || !gradeSample) return { coverM: null, ok: false, reason: 'Need both samples' };

  // Best path: relative barometer using raw pressures (pipe deeper = higher P)
  if (
    Number.isFinite(pipeSample.pressurePa) &&
    Number.isFinite(gradeSample.pressurePa) &&
    pipeSample.pressurePa > 0 &&
    gradeSample.pressurePa > 0
  ) {
    const coverM = relativeHeightFromPressure(gradeSample.pressurePa, pipeSample.pressurePa);
    // relativeHeightFromPressure(pGrade, pPipe) with h = k ln(P_pipe/P_grade)
    if (coverM == null) return { coverM: null, ok: false, reason: 'Bad pressure readings' };
    if (Math.abs(pipeSample.pressurePa - gradeSample.pressurePa) < 1) {
      // < ~1 Pa difference is sensor noise for trench depths — not usable
      return {
        coverM,
        ok: false,
        reason:
          'Barometer readings nearly identical (sensor did not resolve the height change). Use probe/tape.',
        method: 'barometer',
      };
    }
    if (Math.abs(coverM) < MIN_TRUST_M) {
      return {
        coverM,
        ok: false,
        reason: 'Measured delta too small to trust. Use probe/tape.',
        method: 'barometer',
      };
    }
    return { coverM, ok: true, reason: null, method: 'barometer' };
  }

  const a = pipeSample.altitudeM;
  const b = gradeSample.altitudeM;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { coverM: null, ok: false, reason: 'Altitude unavailable on one or both taps' };
  }
  const coverM = b - a;
  if (Math.abs(coverM) < SAME_READING_M) {
    return {
      coverM: 0,
      ok: false,
      reason:
        'Both taps returned the same altitude (common with phone GPS). This is NOT 0 ft of cover — use probe/tape or a phone with a barometer.',
      method: pipeSample.method || 'gps',
    };
  }
  // GPS vertical accuracy is often 10–30+ m — refuse to claim success when accuracy dwarfs cover
  const acc = Math.max(pipeSample.accuracyM || 0, gradeSample.accuracyM || 0);
  if (pipeSample.method === 'gps' || gradeSample.method === 'gps') {
    if (acc > 0 && Math.abs(coverM) < acc * 0.5) {
      return {
        coverM,
        ok: false,
        reason: `GPS vertical accuracy (±${acc.toFixed(0)} m) is larger than the height change. Use probe/tape.`,
        method: 'gps',
      };
    }
  }
  if (Math.abs(coverM) < MIN_TRUST_M) {
    return {
      coverM,
      ok: false,
      reason: 'Delta too small to trust. Use probe/tape.',
      method: pipeSample.method,
    };
  }
  return { coverM, ok: true, reason: null, method: pipeSample.method };
}

export function mountCover(el) {
  el.innerHTML = `
    <p class="muted">Compute cover over pipe and flag against typical minimums. Confirm company / code requirements — educational only.</p>

    <div class="card">
      <h3>Probe / tape (recommended)</h3>
      <p class="muted">Enter measured cover from grade to top of pipe. Most reliable on-site.</p>
      <div class="field-row">
        <div class="field"><label>Feet</label><input id="dc-probe-ft" type="number" inputmode="decimal" min="0" value="3" /></div>
        <div class="field"><label>Inches</label><input id="dc-probe-in" type="number" inputmode="decimal" min="0" step="0.1" value="0" /></div>
      </div>
      <button type="button" class="primary-btn" id="dc-probe-use">Use probe reading in calculator</button>
    </div>

    <div class="card">
      <h3>Phone measure (two taps)</h3>
      <p class="muted">1) Lay phone on <strong>top of pipe</strong> → <strong>On pipe</strong>. 2) Place phone at <strong>grade</strong> → <strong>At grade</strong>. Prefers barometer ΔP; GPS altitude alone is often useless (shows 0 ft when both readings match).</p>
      <div class="btn-row">
        <button type="button" class="primary-btn measure-btn" id="dc-on-pipe">On pipe</button>
        <button type="button" class="primary-btn measure-btn" id="dc-at-grade">At grade</button>
      </div>
      <button type="button" class="secondary-btn" id="dc-reset-meas">Reset measure</button>
      <p class="muted" id="dc-meas-status">Ready — capture On pipe first (or use probe/tape above).</p>
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
        <div class="field"><label>Cover / depth to top (in)</label><input id="dc-depth" type="number" inputmode="decimal" value="36" /></div>
        <div class="field"><label>Pipe OD (in)</label><input id="dc-od" type="number" inputmode="decimal" value="4.5" step="0.1" /></div>
      </div>
      <div class="field-row" id="dc-grade-fields" hidden>
        <div class="field"><label>Finished grade elev</label><input id="dc-grade" type="number" inputmode="decimal" value="100" step="0.01" /></div>
        <div class="field"><label>Top of pipe elev</label><input id="dc-top" type="number" inputmode="decimal" value="97" step="0.01" /></div>
      </div>
      <p class="muted" id="dc-mode-hint">Cover = depth from grade to TOP of pipe (enter that depth directly). OD is reference only.</p>
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
    if (busy) statusEl.textContent = label || 'Sampling… hold still';
  }

  function applyCoverToCalc(coverIn, note) {
    mode = 'trench';
    el.querySelectorAll('#dc-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'trench'));
    el.querySelector('#dc-trench-fields').hidden = false;
    el.querySelector('#dc-grade-fields').hidden = true;
    el.querySelector('#dc-depth').value = coverIn.toFixed(1);
    el.querySelector('#dc-calc').click();
    if (note) statusEl.textContent = note;
  }

  function renderMeasure() {
    if (!pipeSample && !gradeSample) {
      measBox.className = 'result-box';
      measBox.innerHTML = `<div class="big">—</div><div class="muted">No phone samples yet</div>`;
      useBtn.hidden = true;
      lastCoverM = null;
      statusEl.textContent = 'Ready — capture On pipe first (or use probe/tape above).';
      return;
    }

    const lines = [];
    if (pipeSample) {
      lines.push(
        `Pipe: ${
          pipeSample.pressurePa != null
            ? `${(pipeSample.pressurePa / 100).toFixed(2)} hPa`
            : `${formatFtIn(pipeSample.altitudeM)} (${formatMetersShort(pipeSample.altitudeM)})`
        } · ${methodLabel(pipeSample.method)}` +
          (pipeSample.accuracyM != null ? ` · ±${pipeSample.accuracyM.toFixed(1)} m` : '') +
          ` · n=${pipeSample.samples}`
      );
    } else lines.push('Pipe: not captured');

    if (gradeSample) {
      lines.push(
        `Grade: ${
          gradeSample.pressurePa != null
            ? `${(gradeSample.pressurePa / 100).toFixed(2)} hPa`
            : `${formatFtIn(gradeSample.altitudeM)} (${formatMetersShort(gradeSample.altitudeM)})`
        } · ${methodLabel(gradeSample.method)}` +
          (gradeSample.accuracyM != null ? ` · ±${gradeSample.accuracyM.toFixed(1)} m` : '') +
          ` · n=${gradeSample.samples}`
      );
    } else lines.push('Grade: not captured');

    if (pipeSample && gradeSample) {
      const { coverM, ok, reason, method } = computeCover(pipeSample, gradeSample);
      lastCoverM = ok ? coverM : null;
      const coverIn = Number.isFinite(coverM) ? coverM * M_TO_IN : null;

      if (!ok) {
        measBox.className = 'result-box fail';
        measBox.innerHTML = `
          <div class="big">${coverIn != null && Math.abs(coverIn) < 0.5 ? 'N/A' : coverIn != null ? formatFtIn(coverM) : '—'}</div>
          <div>Phone estimate not reliable</div>
          <div class="muted" style="margin-top:8px">${escapeHtml(reason || 'Try probe/tape.')}</div>
          <div class="muted" style="margin-top:8px">${lines.join('<br>')}</div>
        `;
        useBtn.hidden = true;
        statusEl.textContent = reason || 'Use probe/tape for compliance.';
        return;
      }

      measBox.className = 'result-box pass';
      measBox.innerHTML = `
        <div class="big">${formatFtIn(coverM)}</div>
        <div>Estimated cover · ${(coverM * M_TO_FT).toFixed(2)} ft · ${methodLabel(method)}</div>
        <div class="muted" style="margin-top:8px">${lines.join('<br>')}</div>
      `;
      useBtn.hidden = !(coverM > 0);
      statusEl.textContent = 'Measure complete. Verify with tape/probe for compliance.';
    } else {
      lastCoverM = null;
      measBox.className = 'result-box';
      measBox.innerHTML = `<div class="big">…</div><div class="muted">${lines.join('<br>')}</div>`;
      useBtn.hidden = true;
      statusEl.textContent = pipeSample ? 'Now place phone at grade and tap At grade.' : 'Ready — capture On pipe first.';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function capture(which) {
    if (capturing) return;
    setBusy(true, which === 'pipe' ? 'Sampling on pipe… hold still (~2 s)' : 'Sampling at grade… hold still (~2 s)');
    try {
      const sample = await captureAltitudeSample();
      if (
        !sample ||
        (sample.altitudeM == null && sample.pressurePa == null)
      ) {
        if (which === 'pipe') pipeSample = null;
        else gradeSample = null;
        renderMeasure();
        statusEl.textContent =
          'No altitude/pressure available on this device/browser. Use probe/tape (recommended), or try outdoors with a barometer-capable phone.';
        return;
      }
      if (which === 'pipe') pipeSample = sample;
      else gradeSample = sample;
      renderMeasure();
    } finally {
      setBusy(false);
      if (pipeSample && !gradeSample) statusEl.textContent = 'Pipe captured. Now At grade.';
      else if (!pipeSample && gradeSample) statusEl.textContent = 'Grade captured. Still need On pipe.';
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
    applyCoverToCalc(coverIn, `Copied ${coverIn.toFixed(1)}" into calculator.`);
  });

  el.querySelector('#dc-probe-use').addEventListener('click', () => {
    const m = parseFtIn(el.querySelector('#dc-probe-ft').value, el.querySelector('#dc-probe-in').value);
    const coverIn = m * M_TO_IN;
    if (!(coverIn > 0)) {
      statusEl.textContent = 'Enter a probe reading greater than 0.';
      return;
    }
    lastCoverM = m;
    applyCoverToCalc(coverIn, `Probe ${formatFtIn(m)} copied into calculator.`);
    measBox.className = 'result-box pass';
    measBox.innerHTML = `<div class="big">${formatFtIn(m)}</div><div>Probe / tape reading</div>`;
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
        ? 'Cover = depth from grade to TOP of pipe (enter that depth directly). OD is reference only.'
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
    const ftInLabel = (coverIn < 0 ? '−' : '') + `${wholeFt} ft ${remIn.toFixed(1)} in`;
    box.innerHTML = `
      <div class="big">${coverIn.toFixed(1)}"</div>
      <div>${ftInLabel} · ${ft.toFixed(2)} ft</div>
      <div style="margin-top:8px;font-weight:800">${pass ? 'MEETS' : 'BELOW'} min ${minIn}"</div>
      <div class="muted">Δ ${((coverIn - minIn) >= 0 ? '+' : '') + (coverIn - minIn).toFixed(1)}"</div>
    `;
  });
}
