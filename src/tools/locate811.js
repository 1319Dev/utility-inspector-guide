/**
 * 811 / Locate — APWA paint colors + dig checklist
 */
import { load, save, formatStamp } from '../store.js';

const COLORS = [
  { name: 'Electric', hex: '#e11d48', paint: 'Red' },
  { name: 'Gas / Oil / Steam', hex: '#f59e0b', paint: 'Yellow' },
  { name: 'Comm / CATV', hex: '#ea580c', paint: 'Orange' },
  { name: 'Water', hex: '#2563eb', paint: 'Blue' },
  { name: 'Sewer / Drain', hex: '#16a34a', paint: 'Green' },
  { name: 'Reclaimed', hex: '#db2777', paint: 'Purple' },
  { name: 'Proposed excav.', hex: '#f8fafc', paint: 'White' },
  { name: 'Temp survey', hex: '#a855f7', paint: 'Pink' },
];

const CHECKS = [
  { id: 'ticket', label: 'Valid 811 / One-Call ticket on hand' },
  { id: 'marks', label: 'Marks verified on site (match ticket)' },
  { id: 'white', label: 'White proposed excavation marked' },
  { id: 'tolerance', label: 'Tolerance zone understood / hand dig plan' },
  { id: 'photos', label: 'Photos of marks taken before dig' },
  { id: 'conflict', label: 'Conflicts / no-marks called in if needed' },
  { id: 'brief', label: 'Crew briefed on locate colors & hazards' },
];

function state() {
  return load('locate811', { ticket: '', checks: {}, updated: '' });
}

export function mountLocate(el) {
  const st = state();
  el.innerHTML = `
    <div class="card">
      <h3>APWA Uniform Color Code</h3>
      <div class="paint-grid">
        ${COLORS.map(
          (c) => `
          <div class="paint-swatch">
            <span class="swatch" style="background:${c.hex}"></span>
            <span>${c.paint}<br><span class="muted">${c.name}</span></span>
          </div>`
        ).join('')}
      </div>
    </div>
    <div class="card">
      <h3>Pre-dig checklist</h3>
      <div class="field"><label>Ticket #</label><input id="loc-ticket" value="${(st.ticket || '').replace(/"/g, '&quot;')}" placeholder="One-Call ticket" /></div>
      <div class="check-list" id="loc-checks">
        ${CHECKS.map(
          (c) => `
          <label class="check-item">
            <input type="checkbox" data-id="${c.id}" ${st.checks?.[c.id] ? 'checked' : ''} />
            <span>${c.label}</span>
          </label>`
        ).join('')}
      </div>
      <p class="muted" id="loc-updated">${st.updated ? 'Last saved: ' + st.updated : ''}</p>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="loc-save">Save</button>
        <button type="button" class="secondary-btn" id="loc-clear">Clear checks</button>
      </div>
    </div>
  `;

  const persist = () => {
    const checks = {};
    el.querySelectorAll('#loc-checks input').forEach((inp) => {
      checks[inp.dataset.id] = inp.checked;
    });
    const next = {
      ticket: el.querySelector('#loc-ticket').value.trim(),
      checks,
      updated: formatStamp(),
    };
    save('locate811', next);
    el.querySelector('#loc-updated').textContent = 'Last saved: ' + next.updated;
  };

  el.querySelector('#loc-save').addEventListener('click', persist);
  el.querySelector('#loc-checks').addEventListener('change', persist);
  el.querySelector('#loc-ticket').addEventListener('change', persist);
  el.querySelector('#loc-clear').addEventListener('click', () => {
    el.querySelectorAll('#loc-checks input').forEach((inp) => (inp.checked = false));
    persist();
  });
}
