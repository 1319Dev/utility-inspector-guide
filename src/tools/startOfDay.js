/**
 * Start of Day checklist — never hard-blocks; override is auditable.
 */
import { loadSettings } from '../store.js';
import { listRecords, putRecord } from '../data/records.js';
import { getActiveProject, getActiveProjectId, projectLabel } from '../data/context.js';
import { START_OF_DAY_SECTIONS } from '../data/constants.js';
import { esc, stickySave, complianceNote, statusPill, todayISO, fmtWhen } from '../ui/dom.js';
import { getTodaysCrewDay } from './crewDay.js';

export async function mountStartOfDay(root) {
  const s = loadSettings();
  const project = await getActiveProject();
  const projectId = getActiveProjectId();
  const today = todayISO();
  const [rows, crew] = await Promise.all([
    listRecords('startOfDayChecks'),
    getTodaysCrewDay(projectId),
  ]);
  const existing = rows.find((r) => r.date === today && (!projectId || r.projectId === projectId)) || null;

  const checks = {};
  for (const sec of START_OF_DAY_SECTIONS) {
    checks[sec.id] = {};
    for (const item of sec.items) {
      checks[sec.id][item.id] = existing?.checks?.[sec.id]?.[item.id] || { ok: false, notes: '' };
    }
  }

  const incomplete = () => {
    const missing = [];
    for (const sec of START_OF_DAY_SECTIONS) {
      for (const item of sec.items) {
        if (!checks[sec.id][item.id].ok) missing.push(item.label);
      }
    }
    return missing;
  };

  const paintResult = () => {
    const miss = incomplete();
    const ready = miss.length === 0;
    const box = root.querySelector('#sod-result');
    box.dataset.state = ready ? 'ready' : 'warn';
    box.innerHTML = ready
      ? statusPill('ready', 'READY FOR WORK')
      : `${statusPill('warn', 'ISSUES REQUIRE DOCUMENTATION')}<p class="muted">${miss.length} item(s) unchecked. You may still proceed with an override.</p>`;
    root.querySelector('#sod-override-wrap').hidden = ready;
  };

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>Start of Day</h3>
      <p class="muted">${project ? esc(projectLabel(project)) : 'No active project'} · ${esc(today)}</p>
      <div id="sod-result" class="result-box"></div>
      ${
        crew
          ? `<p class="muted">Crew: ${esc(String(crew.results?.workers ?? crew.crew?.length ?? 0))} workers · ${
              crew.allVerified ? 'OQs verified' : 'exceptions documented'
            }</p>`
          : `<p class="muted">No crew verification yet — <button type="button" class="secondary-btn" data-nav="crew">Open crew check</button></p>`
      }
    </div>
    ${START_OF_DAY_SECTIONS.map(
      (sec) => `
      <div class="card">
        <h3>${esc(sec.title)}</h3>
        <div class="check-list">
          ${sec.items
            .map((item) => {
              const row = checks[sec.id][item.id];
              return `<label class="check-item">
                <input type="checkbox" class="sod-ck" data-sec="${esc(sec.id)}" data-id="${esc(item.id)}" ${row.ok ? 'checked' : ''} />
                <span>${esc(item.label)}</span>
              </label>`;
            })
            .join('')}
        </div>
      </div>`
    ).join('')}
    <div class="card" id="sod-override-wrap">
      <h3>Override (auditable)</h3>
      <p class="muted">Start of Day never hard-blocks work. Document why you are proceeding with issues.</p>
      <div class="field"><label>Reason</label>
        <input id="sod-reason" value="${esc(existing?.override?.reason || '')}" placeholder="Why work may proceed" />
      </div>
      <div class="field"><label>Inspector name</label>
        <input id="sod-insp" value="${esc(existing?.override?.inspector || s.inspectorName || '')}" />
      </div>
      <div class="field"><label>Notes</label>
        <textarea id="sod-notes" rows="3">${esc(existing?.override?.notes || existing?.notes || '')}</textarea>
      </div>
    </div>
    ${stickySave('sod-save', 'Save Start of Day')}
    <div class="card">
      <h3>Recent</h3>
      <div class="list" id="sod-hist"></div>
    </div>
  `;

  paintResult();

  root.querySelectorAll('.sod-ck').forEach((cb) => {
    cb.addEventListener('change', () => {
      checks[cb.dataset.sec][cb.dataset.id].ok = cb.checked;
      paintResult();
    });
  });

  const status = (msg) => {
    const el = root.querySelector('#sod-save-status');
    if (el) el.textContent = msg || '';
  };

  root.querySelector('#sod-save').addEventListener('click', async () => {
    const miss = incomplete();
    const ready = miss.length === 0;
    const reason = root.querySelector('#sod-reason')?.value.trim() || '';
    const inspector = root.querySelector('#sod-insp')?.value.trim() || s.inspectorName || '';
    const notes = root.querySelector('#sod-notes')?.value.trim() || '';
    if (!ready && !reason) {
      status('Unchecked items — enter an override reason to save, or complete the list.');
      return;
    }
    try {
      const saved = await putRecord('startOfDayChecks', {
        id: existing?.id,
        date: today,
        projectId: projectId || null,
        inspector: inspector || s.inspectorName || '',
        completedAt: new Date().toISOString(),
        checks,
        result: ready ? 'ready' : 'issues',
        missing: miss,
        crewDayId: crew?.id || null,
        override: ready
          ? { used: false }
          : {
              used: true,
              reason,
              inspector,
              timestamp: new Date().toISOString(),
              notes,
            },
        notes,
      });
      status(
        saved.result === 'ready'
          ? `READY FOR WORK · ${fmtWhen(saved.completedAt)}`
          : `Issues documented with override · ${fmtWhen(saved.completedAt)}`
      );
      paintHist(saved);
    } catch (err) {
      status(err?.message || 'Save failed.');
    }
  });

  function paintHist(latest) {
    const list = latest ? [latest, ...rows.filter((r) => r.id !== latest.id)] : rows;
    const box = root.querySelector('#sod-hist');
    if (!list.length) {
      box.innerHTML = '<p class="muted">No Start of Day records yet.</p>';
      return;
    }
    box.innerHTML = list
      .slice(0, 12)
      .map((r) => {
        const ready = r.result === 'ready';
        return `<div class="list-item">
          <strong>${esc(r.date)}</strong>
          <span class="meta">${statusPill(ready ? 'ready' : 'warn', ready ? 'READY FOR WORK' : 'ISSUES / OVERRIDE')} · ${esc(r.inspector || '—')} · ${esc(fmtWhen(r.completedAt))}</span>
        </div>`;
      })
      .join('');
  }
  paintHist();
}
