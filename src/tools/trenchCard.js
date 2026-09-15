/**
 * Daily Trench Card — soil, protective system, spoil, egress, sign-off
 */
import { load, save, loadSettings, saveSettings, downloadText, formatStamp } from '../store.js';

function draft() {
  return load('trenchCard', null);
}

export function mountTrenchCard(el) {
  const s = loadSettings();
  const d = draft() || {};
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `
    <p class="muted">Daily excavation card for field reference. Export text to share or print. Not a legal form substitute.</p>
    <div class="card">
      <div class="field-row">
        <div class="field"><label>Date</label><input id="tc-date" type="date" value="${d.date || today}" /></div>
        <div class="field"><label>Location / job</label><input id="tc-loc" value="${esc(d.location || '')}" /></div>
      </div>
      <div class="field"><label>Soil type</label>
        <select id="tc-soil">
          ${['A','B','C','Other'].map((x) => `<option ${ (d.soil || s.lastSoil || 'B') === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Protective system</label>
        <select id="tc-protect">
          ${['Slope','Bench','Shield','Trench box','Other'].map((x) => `<option ${ (d.protect || 'Slope') === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </div>
      <div class="check-list">
        <label class="check-item"><input type="checkbox" id="tc-spoil" ${d.spoil ? 'checked' : ''} /><span>Spoil / equipment ≥ 2 ft from edge</span></label>
        <label class="check-item"><input type="checkbox" id="tc-ladder" ${d.ladder ? 'checked' : ''} /><span>Ladder / egress ≤ 25 ft lateral travel</span></label>
        <label class="check-item"><input type="checkbox" id="tc-water" ${d.water ? 'checked' : ''} /><span>No hazardous water accumulation (or controlled)</span></label>
        <label class="check-item"><input type="checkbox" id="tc-inspect" ${d.inspect ? 'checked' : ''} /><span>Daily inspection completed</span></label>
      </div>
      <div class="field"><label>Competent person</label><input id="tc-cp" value="${esc(d.competent || s.inspectorName || '')}" /></div>
      <div class="field"><label>Notes</label><textarea id="tc-notes">${esc(d.notes || '')}</textarea></div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="tc-save">Save draft</button>
        <button type="button" class="primary-btn" id="tc-export">Export / share text</button>
      </div>
    </div>
  `;

  const collect = () => ({
    date: el.querySelector('#tc-date').value,
    location: el.querySelector('#tc-loc').value.trim(),
    soil: el.querySelector('#tc-soil').value,
    protect: el.querySelector('#tc-protect').value,
    spoil: el.querySelector('#tc-spoil').checked,
    ladder: el.querySelector('#tc-ladder').checked,
    water: el.querySelector('#tc-water').checked,
    inspect: el.querySelector('#tc-inspect').checked,
    competent: el.querySelector('#tc-cp').value.trim(),
    notes: el.querySelector('#tc-notes').value.trim(),
  });

  el.querySelector('#tc-save').addEventListener('click', () => {
    const data = collect();
    save('trenchCard', data);
    saveSettings({ inspectorName: data.competent, lastSoil: data.soil === 'Other' ? s.lastSoil : data.soil });
    alert('Draft saved on this device.');
  });

  el.querySelector('#tc-export').addEventListener('click', async () => {
    const data = collect();
    save('trenchCard', data);
    const yn = (b) => (b ? 'YES' : 'NO');
    const text = [
      'DAILY TRENCH CARD — Utility Inspector Guide',
      `Date: ${data.date}`,
      `Location: ${data.location || '—'}`,
      `Soil type: ${data.soil}`,
      `Protective system: ${data.protect}`,
      `Spoil ≥2 ft: ${yn(data.spoil)}`,
      `Egress ≤25 ft: ${yn(data.ladder)}`,
      `Water controlled: ${yn(data.water)}`,
      `Daily inspection: ${yn(data.inspect)}`,
      `Competent person: ${data.competent || '—'}`,
      `Notes: ${data.notes || '—'}`,
      `Exported: ${formatStamp()}`,
      '',
      'Educational / field reference only.',
    ].join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Daily Trench Card', text });
        return;
      } catch {}
    }
    downloadText(`trench-card-${data.date || 'draft'}.txt`, text);
  });
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
