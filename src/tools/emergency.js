/**
 * Emergency — editable contacts + nearest ER note
 */
import { loadSettings, saveSettings } from '../store.js';

export function mountEmergency(el) {
  const s = loadSettings();
  const contacts = s.emergencyContacts || [
    { name: 'Supervisor', phone: '' },
    { name: 'Gas Control', phone: '' },
    { name: '911 / ER', phone: '911' },
  ];

  el.innerHTML = `
    <p class="muted">Keep emergency numbers on the home screen of this app. Stored only on this device.</p>
    <div class="card" id="em-list">
      ${contacts
        .map(
          (c, i) => `
        <div class="field-row em-row" data-i="${i}">
          <div class="field"><label>Name</label><input class="em-name" value="${esc(c.name)}" /></div>
          <div class="field"><label>Phone</label><input class="em-phone" type="tel" value="${esc(c.phone)}" /></div>
        </div>
        ${c.phone ? `<a class="call-btn" href="tel:${esc(c.phone)}">Call ${esc(c.name || 'contact')}</a>` : ''}
      `
        )
        .join('')}
    </div>
    <div class="card">
      <div class="field"><label>Nearest ER / clinic note</label>
        <textarea id="em-er" placeholder="Address, cross-street, drive time…">${esc(s.nearestEr || '')}</textarea>
      </div>
      <div class="field"><label>Your name (for other tools)</label>
        <input id="em-inspector" value="${esc(s.inspectorName || '')}" />
      </div>
      <button type="button" class="primary-btn" id="em-save">Save</button>
      <p class="muted" id="em-status"></p>
    </div>
  `;

  el.querySelector('#em-save').addEventListener('click', () => {
    const rows = [...el.querySelectorAll('.em-row')];
    const emergencyContacts = rows.map((row) => ({
      name: row.querySelector('.em-name').value.trim(),
      phone: row.querySelector('.em-phone').value.trim(),
    }));
    saveSettings({
      emergencyContacts,
      nearestEr: el.querySelector('#em-er').value.trim(),
      inspectorName: el.querySelector('#em-inspector').value.trim(),
    });
    el.querySelector('#em-status').textContent = 'Saved.';
    mountEmergency(el);
  });
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
