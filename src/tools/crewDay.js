/**
 * Daily Crew Verification — roster + required OQs + auditable CrewDay.
 */
import { loadSettings } from '../store.js';
import { listRecords, putRecord } from '../data/records.js';
import { getActiveProject, getActiveProjectId, projectLabel } from '../data/context.js';
import { CREW_ROLES } from '../data/constants.js';
import { displayOqStatus, evaluateRequired, statusMeta, workerOqs } from '../data/oq.js';
import { esc, stickySave, complianceNote, optionList, statusPill, todayISO, fmtWhen } from '../ui/dom.js';
import { uid } from '../store.js';

export async function mountCrewDay(root) {
  const s = loadSettings();
  const project = await getActiveProject();
  const projectId = getActiveProjectId();
  const [workers, oqs, crewDays] = await Promise.all([
    listRecords('workers'),
    listRecords('oqRecords'),
    listRecords('crewDays'),
  ]);

  const today = todayISO();
  const existing = crewDays.find((c) => c.date === today && (!projectId || c.projectId === projectId)) || null;

  const activeWorkers = workers.filter((w) => w.active !== false);
  let roster = existing?.crew ? existing.crew.map((m) => ({ ...m })) : [];

  const roleOpts = CREW_ROLES;
  const workerOpts = [
    { id: '', label: '— Add worker —' },
    ...activeWorkers.map((w) => ({ id: w.id, label: `${w.name}${w.role ? ` · ${w.role}` : ''}` })),
  ];

  const evalMember = (m) => {
    const wOqs = workerOqs(oqs, m.workerId);
    const required = m.requiredOqs || wOqs.map((r) => r.id);
    const ev = evaluateRequired(wOqs, required);
    return { ...m, ...ev, requiredOqs: required };
  };

  const paintRoster = () => {
    roster = roster.map(evalMember);
    const box = root.querySelector('#crew-roster');
    if (!roster.length) {
      box.innerHTML = '<p class="muted">No one on today’s roster yet.</p>';
      paintSummary();
      return;
    }
    box.innerHTML = roster
      .map((m, i) => {
        const w = workers.find((x) => x.id === m.workerId);
        const wOqs = workerOqs(oqs, m.workerId);
        const checks = wOqs
          .map((r) => {
            const on = (m.requiredOqs || []).includes(r.id);
            const disp = displayOqStatus(r);
            return `<label class="check-item">
              <input type="checkbox" class="crew-oq" data-i="${i}" data-oid="${esc(r.id)}" ${on ? 'checked' : ''} />
              ${esc(r.taskNumber || '')} ${esc(r.taskDesc || '')} ${statusPill(disp, statusMeta(disp).label)}
            </label>`;
          })
          .join('');
        const issueBits = [];
        if (m.missing?.length) issueBits.push(`Missing: ${m.missing.join(', ')}`);
        if (m.expiring?.length) issueBits.push(`Expiring: ${m.expiring.join(', ')}`);
        return `<div class="card crew-member">
          <strong>${esc(w?.name || m.name || 'Worker')}</strong>
          <span class="meta">${esc(w?.company || '')} · ${statusPill(m.ok ? 'qualified' : 'expired', m.ok ? 'OK' : 'Issues')}</span>
          <div class="field"><label>Role</label>
            <select class="crew-role" data-i="${i}">${optionList(roleOpts, m.role)}</select>
          </div>
          ${wOqs.length ? `<div class="check-list">${checks}</div>` : '<p class="muted">No OQ records for this worker — add them in OQ Center.</p>'}
          ${issueBits.length ? `<p class="error">${esc(issueBits.join(' · '))}</p>` : ''}
          <button type="button" class="danger-btn crew-rm" data-i="${i}">Remove</button>
        </div>`;
      })
      .join('');

    box.querySelectorAll('.crew-role').forEach((sel) => {
      sel.addEventListener('change', () => {
        roster[Number(sel.dataset.i)].role = sel.value;
      });
    });
    box.querySelectorAll('.crew-oq').forEach((cb) => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.i);
        const oid = cb.dataset.oid;
        const set = new Set(roster[i].requiredOqs || []);
        if (cb.checked) set.add(oid);
        else set.delete(oid);
        roster[i].requiredOqs = [...set];
        paintRoster();
      });
    });
    box.querySelectorAll('.crew-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        roster.splice(Number(btn.dataset.i), 1);
        paintRoster();
      });
    });
    paintSummary();
  };

  const paintSummary = () => {
    const n = roster.length;
    const issues = roster.filter((m) => !evalMember(m).ok).length;
    const ok = n - issues;
    const banner = root.querySelector('#crew-summary');
    const state = !n ? 'idle' : issues ? 'warn' : 'ready';
    banner.dataset.state = state;
    banner.innerHTML = `<strong>${n} workers</strong> · ${ok} compliant · ${issues} issues`;
  };

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>Daily crew verification</h3>
      <p class="muted">${project ? esc(projectLabel(project)) : 'No active project — set one on Home or Projects.'} · ${esc(today)}</p>
      <div id="crew-summary" class="result-box" data-state="idle">0 workers</div>
      <div class="field"><label>Add from personnel</label>
        <select id="crew-add">${optionList(workerOpts, '')}</select>
      </div>
      <button type="button" class="primary-btn" id="crew-verify-top">All OQs Verified</button>
      <p class="muted">Inspector: ${esc(s.inspectorName || 'set name in Emergency / More')}</p>
    </div>
    <div id="crew-roster"></div>
    <div class="card">
      <h3>Exceptions</h3>
      <div class="field"><label>Notes / exceptions</label>
        <textarea id="crew-ex" rows="3" placeholder="Document missing OQs, visitors, etc.">${esc(existing?.exceptions || '')}</textarea>
      </div>
    </div>
    ${stickySave('crew-verify', 'All OQs Verified')}
    <p class="muted" id="crew-hist-label">Creates an auditable CrewDay (inspector, datetime, project, roster, results, exceptions). Does not hard-block work.</p>
    <div class="card">
      <h3>Recent crew days</h3>
      <div class="list" id="crew-hist"></div>
    </div>
  `;

  paintRoster();

  root.querySelector('#crew-add').addEventListener('change', () => {
    const id = root.querySelector('#crew-add').value;
    root.querySelector('#crew-add').value = '';
    if (!id) return;
    if (roster.some((m) => m.workerId === id)) return;
    const w = workers.find((x) => x.id === id);
    const wOqs = workerOqs(oqs, id);
    roster.push({
      id: uid(),
      workerId: id,
      name: w?.name || '',
      role: guessRole(w?.role),
      requiredOqs: wOqs.map((r) => r.id),
    });
    paintRoster();
  });

  const status = (msg) => {
    const el = root.querySelector('#crew-verify-status');
    if (el) el.textContent = msg || '';
  };

  root.querySelector('#crew-verify').addEventListener('click', verifyCrew);
  root.querySelector('#crew-verify-top')?.addEventListener('click', verifyCrew);

  async function verifyCrew() {
    roster = roster.map(evalMember);
    const issues = roster.filter((m) => !m.ok);
    const exceptions = root.querySelector('#crew-ex').value.trim();
    if (issues.length && !exceptions) {
      status('Issues found — add exception notes, then save. Work is not blocked.');
      return;
    }
    try {
      const saved = await putRecord('crewDays', {
        id: existing?.id,
        date: today,
        projectId: projectId || null,
        inspector: s.inspectorName || '',
        verifiedAt: new Date().toISOString(),
        allVerified: issues.length === 0,
        crew: roster.map((m) => ({
          id: m.id,
          workerId: m.workerId,
          name: m.name,
          role: m.role,
          requiredOqs: m.requiredOqs,
          ok: m.ok,
          missing: m.missing,
          expiring: m.expiring,
        })),
        results: {
          workers: roster.length,
          compliant: roster.length - issues.length,
          issues: issues.length,
        },
        exceptions,
      });
      status(
        saved.allVerified
          ? `All OQs verified ${fmtWhen(saved.verifiedAt)}.`
          : `Crew day saved with ${issues.length} documented exception(s).`
      );
      paintHist(saved);
    } catch (err) {
      status(err?.message || 'Save failed.');
    }
  }

  function paintHist(latest) {
    const list = latest ? [latest, ...crewDays.filter((c) => c.id !== latest.id)] : crewDays;
    const box = root.querySelector('#crew-hist');
    if (!list.length) {
      box.innerHTML = '<p class="muted">No crew days yet.</p>';
      return;
    }
    box.innerHTML = list
      .slice(0, 12)
      .map((c) => {
        const n = c.crew?.length || c.results?.workers || 0;
        const ok = c.allVerified;
        return `<div class="list-item">
          <strong>${esc(c.date)}</strong>
          <span class="meta">${statusPill(ok ? 'qualified' : 'warn', ok ? 'All verified' : 'Exceptions')} · ${n} workers · ${esc(c.inspector || '—')} · ${esc(fmtWhen(c.verifiedAt))}</span>
        </div>`;
      })
      .join('');
  }
  paintHist();
}

function guessRole(role) {
  const r = String(role || '').toLowerCase();
  if (!r) return 'other';
  const hit = CREW_ROLES.find((x) => r.includes(x.id) || r.includes(x.label.toLowerCase()));
  return hit?.id || 'other';
}

export async function getTodaysCrewDay(projectId) {
  const pid = projectId || getActiveProjectId();
  const days = await listRecords('crewDays');
  const today = todayISO();
  return days.find((c) => c.date === today && (!pid || c.projectId === pid)) || null;
}
