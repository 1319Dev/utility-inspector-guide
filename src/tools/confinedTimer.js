/**
 * Confined Space Timer — countdown/interval alarm + atmosphere placeholders
 */
export function mountConfined(el) {
  el.innerHTML = `
    <p class="muted">Simple timer with atmosphere reminder fields. Manual entry only — not a gas monitor. Follow your permit program.</p>
    <div class="card">
      <div class="timer-display" id="cf-time">00:00</div>
      <div class="field-row">
        <div class="field"><label>Interval alarm (min)</label><input id="cf-interval" type="number" value="15" min="1" /></div>
        <div class="field"><label>Mode</label>
          <select id="cf-mode"><option value="up">Count up</option><option value="down">Count down</option></select>
        </div>
      </div>
      <div class="field" id="cf-down-wrap" hidden>
        <label>Countdown minutes</label>
        <input id="cf-down" type="number" value="30" min="1" />
      </div>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="cf-start">Start</button>
        <button type="button" class="secondary-btn" id="cf-pause">Pause</button>
        <button type="button" class="danger-btn" id="cf-reset">Reset</button>
      </div>
      <p class="muted" id="cf-alarm">Next check-in: —</p>
    </div>
    <div class="card">
      <h3>Atmosphere (manual)</h3>
      <div class="field-row">
        <div class="field"><label>O₂ %</label><input id="cf-o2" type="number" inputmode="decimal" placeholder="19.5–23.5" /></div>
        <div class="field"><label>LEL %</label><input id="cf-lel" type="number" inputmode="decimal" placeholder="<10%" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>H₂S ppm</label><input id="cf-h2s" type="number" inputmode="decimal" /></div>
        <div class="field"><label>CO ppm</label><input id="cf-co" type="number" inputmode="decimal" /></div>
      </div>
      <p class="disclaimer muted">Enter readings from a calibrated monitor. This app does not measure atmosphere.</p>
    </div>
  `;

  let running = false;
  let mode = 'up';
  let elapsed = 0; // seconds
  let remaining = 30 * 60;
  let lastAlarmAt = 0;
  let timer = null;

  const display = el.querySelector('#cf-time');
  const alarmEl = el.querySelector('#cf-alarm');

  const fmt = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };

  const buzz = () => {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    } catch {}
    alarmEl.textContent = '⏰ CHECK-IN / ATMOSPHERE — re-verify conditions';
    alarmEl.style.color = '#fde047';
    // Web Audio beep
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 500);
    } catch {}
  };

  const tick = () => {
    if (!running) return;
    if (mode === 'up') {
      elapsed += 1;
      display.textContent = fmt(elapsed);
      const intervalSec = (Number(el.querySelector('#cf-interval').value) || 15) * 60;
      if (elapsed - lastAlarmAt >= intervalSec) {
        lastAlarmAt = elapsed;
        buzz();
      } else {
        const next = intervalSec - ((elapsed - lastAlarmAt) % intervalSec);
        alarmEl.style.color = '';
        alarmEl.textContent = `Next check-in: ${fmt(next)}`;
      }
    } else {
      remaining -= 1;
      display.textContent = fmt(remaining);
      if (remaining <= 0) {
        running = false;
        clearInterval(timer);
        buzz();
        alarmEl.textContent = 'Countdown finished';
      }
    }
  };

  el.querySelector('#cf-mode').addEventListener('change', () => {
    mode = el.querySelector('#cf-mode').value;
    el.querySelector('#cf-down-wrap').hidden = mode !== 'down';
  });

  el.querySelector('#cf-start').addEventListener('click', () => {
    if (running) return;
    mode = el.querySelector('#cf-mode').value;
    if (mode === 'down' && remaining <= 0) {
      remaining = (Number(el.querySelector('#cf-down').value) || 30) * 60;
    }
    if (mode === 'down' && elapsed === 0 && remaining === 30 * 60) {
      remaining = (Number(el.querySelector('#cf-down').value) || 30) * 60;
    }
    running = true;
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    alarmEl.textContent = 'Running…';
  });

  el.querySelector('#cf-pause').addEventListener('click', () => {
    running = false;
    clearInterval(timer);
    alarmEl.textContent = 'Paused';
  });

  el.querySelector('#cf-reset').addEventListener('click', () => {
    running = false;
    clearInterval(timer);
    elapsed = 0;
    lastAlarmAt = 0;
    remaining = (Number(el.querySelector('#cf-down').value) || 30) * 60;
    display.textContent = mode === 'down' ? fmt(remaining) : '00:00';
    alarmEl.textContent = 'Next check-in: —';
    alarmEl.style.color = '';
  });
}
