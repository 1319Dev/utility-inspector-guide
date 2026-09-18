/**
 * OQ Verification Center — manual documentation + optional proof attach.
 * ISNetworld / Veriforce are source labels only, not live integrations.
 */
import { loadSettings } from '../store.js';
import {
  listRecords,
  getRecord,
  putRecord,
  deleteRecord,
  putAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
} from '../data/records.js';
import { getActiveProject, getActiveProjectId, projectLabel } from '../data/context.js';
import { OQ_STATUSES, OQ_SOURCES } from '../data/constants.js';
import { displayOqStatus, oqAlerts, statusMeta, daysUntil } from '../data/oq.js';
import { esc, stickySave, complianceNote, optionList, statusPill, todayISO, fmtWhen } from '../ui/dom.js';
import { navigate, takeEditId } from '../ui/navigate.js';
import { downloadBlob } from '../store.js';

export async function mountOqCenter(root) {
  const [records, workers, projects] = await Promise.all([
    listRecords('oqRecords'),
    listRecords('workers'),
    listRecords('projects'),
  ]);
  const alerts = oqAlerts(records);

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>OQ Verification Center</h3>
      <p class="muted">Manual documentation only. ISNetworld and Veriforce appear as source labels — this app does not connect to those systems.</p>
      <div class="field"><label>Search</label><input id="oq-q" placeholder="Worker, task, contractor" /></div>
      <div class="field-row">
        <div class="field"><label>Status</label>
          <select id="oq-status">
            <option value="">All statuses</option>
            ${optionList(OQ_STATUSES, '')}
          </select>
        </div>
        <div class="field"><label>Alert window</label>
          <select id="oq-win">
            <option value="">Any</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>
      <button type="button" class="primary-btn" id="oq-new">New verification</button>
    </div>
    ${
      alerts.length
        ? `<div class="card alert-card">
            <h3>Expiring / expired</h3>
            <div class="list">${alerts
              .slice(0, 10)
              .map((a) => {
                const s = displayOqStatus(a.rec);
                const label = s === 'expired' ? 'Expired' : `${a.days}d`;
                return `<button type="button" class="list-item list-btn oq-open" data-id="${esc(a.rec.id)}">
                  <strong>${esc(a.rec.workerName || 'Worker')} · ${esc(a.rec.taskNumber || a.rec.taskDesc || 'Task')}</strong>
                  <span class="meta">${statusPill(s, `${statusMeta(s).label} · ${label}`)}</span>
                </button>`;
              })
              .join('')}</div>
          </div>`
        : ''
    }
    <div class="list" id="oq-list"></div>
  `;

  const workerName = (id) => workers.find((w) => w.id === id)?.name || '';

  const paint = () => {
    const q = (root.querySelector('#oq-q').value || '').trim().toLowerCase();
    const st = root.querySelector('#oq-status').value;
    const win = root.querySelector('#oq-win').value;
    const rows = records.filter((r) => {
      const disp = displayOqStatus(r);
      if (st && disp !== st && r.status !== st) return false;
      if (win === 'expired' && disp !== 'expired') return false;
      if (win && win !== 'expired') {
        const d = daysUntil(r.expirationDate);
        if (d == null || d < 0 || d > Number(win)) return false;
      }
      if (!q) return true;
      const blob = `${r.workerName} ${workerName(r.workerId)} ${r.taskNumber} ${r.taskDesc} ${r.contractor} ${r.employer} ${r.foreman}`.toLowerCase();
      return blob.includes(q);
    });
    const box = root.querySelector('#oq-list');
    if (!rows.length) {
      box.innerHTML = '<p class="muted">No matching verifications.</p>';
      return;
    }
    box.innerHTML = rows
      .map((r) => {
        const disp = displayOqStatus(r);
        const proj = projects.find((p) => p.id === r.projectId);
        return `<div class="list-item">
          <strong>${esc(r.workerName || workerName(r.workerId) || 'Worker')} · ${esc(r.taskNumber || '—')} ${esc(r.taskDesc || '')}</strong>
          <span class="meta">${statusPill(disp, statusMeta(disp).label)} · ${esc(proj?.name || 'No project')} · exp ${esc(r.expirationDate || '—')}</span>
          <button type="button" class="secondary-btn oq-open" data-id="${esc(r.id)}">Open</button>
        </div>`;
      })
      .join('');
    box.querySelectorAll('.oq-open').forEach((btn) => {
      btn.addEventListener('click', () => navigate('oq-edit', { editId: btn.dataset.id }));
    });
  };

  paint();
  root.querySelector('#oq-q').addEventListener('input', paint);
  root.querySelector('#oq-status').addEventListener('change', paint);
  root.querySelector('#oq-win').addEventListener('change', paint);
  root.querySelector('#oq-new').addEventListener('click', () => navigate('oq-edit', { editId: '' }));
  root.querySelectorAll('.alert-card .oq-open').forEach((btn) => {
    btn.addEventListener('click', () => navigate('oq-edit', { editId: btn.dataset.id }));
  });
}

export async function mountOqEdit(root) {
  const id = takeEditId('oq-edit');
  const existing = id ? await getRecord('oqRecords', id) : null;
  const [workers, projects] = await Promise.all([listRecords('workers'), listRecords('projects')]);
  const s = loadSettings();
  const active = await getActiveProject();
  const rec = {
    workerId: '',
    workerName: '',
    employer: '',
    contractor: '',
    foreman: '',
    taskNumber: '',
    taskDesc: '',
    status: 'qualified',
    effectiveDate: todayISO(),
    expirationDate: '',
    evaluator: '',
    verificationSource: 'employer_records',
    verificationDatetime: new Date().toISOString().slice(0, 16),
    inspector: s.inspectorName || '',
    projectId: getActiveProjectId() || '',
    station: s.currentStation || '',
    notes: '',
    ...(existing || {}),
  };
  const attachments = existing ? await listAttachments(existing.id) : [];
  let heldId = existing?.id || null;

  const workerOpts = [
    { id: '', label: '— Select worker —' },
    ...workers.map((w) => ({ id: w.id, label: `${w.name}${w.company ? ` (${w.company})` : ''}` })),
  ];
  const projectOpts = [
    { id: '', label: '— No project —' },
    ...projects.map((p) => ({ id: p.id, label: projectLabel(p) })),
  ];

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>${existing ? 'OQ verification' : 'New OQ verification'}</h3>
      <p class="muted">Proof upload is optional. Status colors: qualified green, expiring yellow, expired / not qualified red, unable to verify gray.</p>
      <div class="field"><label>Worker</label>
        <select id="oq-worker">${optionList(workerOpts, rec.workerId)}</select>
      </div>
      <div class="field"><label>Worker name (if not in database)</label>
        <input id="oq-wname" value="${esc(rec.workerName)}" />
      </div>
      <div class="field"><label>Employer</label><input id="oq-emp" value="${esc(rec.employer)}" /></div>
      <div class="field"><label>Contractor</label><input id="oq-con" value="${esc(rec.contractor)}" /></div>
      <div class="field"><label>Foreman</label><input id="oq-fore" value="${esc(rec.foreman)}" /></div>
      <div class="field-row">
        <div class="field"><label>Task #</label><input id="oq-taskn" value="${esc(rec.taskNumber)}" /></div>
        <div class="field"><label>Status</label>
          <select id="oq-st">${optionList(OQ_STATUSES, rec.status)}</select>
        </div>
      </div>
      <div class="field"><label>Task description</label><input id="oq-taskd" value="${esc(rec.taskDesc)}" /></div>
      <div class="field-row">
        <div class="field"><label>Effective</label><input id="oq-eff" type="date" value="${esc(rec.effectiveDate)}" /></div>
        <div class="field"><label>Expiration</label><input id="oq-exp" type="date" value="${esc(rec.expirationDate)}" /></div>
      </div>
      <div class="field"><label>Evaluator</label><input id="oq-eval" value="${esc(rec.evaluator)}" /></div>
      <div class="field"><label>Verification source (manual label)</label>
        <select id="oq-src">${optionList(OQ_SOURCES, rec.verificationSource)}</select>
      </div>
      <p class="muted">ISNetworld / Veriforce are <strong>not</strong> connected. Choose them only to record that you looked there.</p>
      <div class="field"><label>Verification date/time</label>
        <input id="oq-vdt" type="datetime-local" value="${esc(String(rec.verificationDatetime || '').slice(0, 16))}" />
      </div>
      <div class="field"><label>Inspector</label><input id="oq-insp" value="${esc(rec.inspector)}" /></div>
      <div class="field"><label>Project</label>
        <select id="oq-proj">${optionList(projectOpts, rec.projectId || '')}</select>
      </div>
      <div class="field"><label>Station</label><input id="oq-sta" value="${esc(rec.station)}" inputmode="decimal" /></div>
      <div class="field"><label>Notes</label><textarea id="oq-notes" rows="3">${esc(rec.notes)}</textarea></div>
      <div id="oq-disp"></div>
    </div>

    <div class="card">
      <h3>Proof (optional)</h3>
      <div class="field"><label>Photo or PDF</label><input id="oq-file" type="file" accept="image/*,.pdf,application/pdf" /></div>
      <button type="button" class="secondary-btn" id="oq-file-add">Attach proof</button>
      <div class="list" id="oq-att-list"></div>
    </div>

    ${stickySave('oq-save', existing ? 'Save verification' : 'Save verification')}
    ${existing ? `<button type="button" class="danger-btn" id="oq-del">Delete</button>` : ''}
    ${active ? `<p class="muted">Active project: ${esc(projectLabel(active))}</p>` : ''}
  `;

  const paintDisp = () => {
    const fake = {
      status: root.querySelector('#oq-st').value,
      expirationDate: root.querySelector('#oq-exp').value,
    };
    const disp = displayOqStatus(fake);
    root.querySelector('#oq-disp').innerHTML = statusPill(disp, statusMeta(disp).label);
  };
  paintDisp();
  root.querySelector('#oq-st').addEventListener('change', paintDisp);
  root.querySelector('#oq-exp').addEventListener('change', paintDisp);

  root.querySelector('#oq-worker').addEventListener('change', () => {
    const w = workers.find((x) => x.id === root.querySelector('#oq-worker').value);
    if (!w) return;
    if (!root.querySelector('#oq-wname').value.trim()) root.querySelector('#oq-wname').value = w.name;
    if (!root.querySelector('#oq-emp').value.trim()) root.querySelector('#oq-emp').value = w.company || '';
  });

  const status = (msg) => {
    const el = root.querySelector('#oq-save-status');
    if (el) el.textContent = msg || '';
  };

  const paintAtt = () => {
    const box = root.querySelector('#oq-att-list');
    if (!attachments.length) {
      box.innerHTML = '<p class="muted">No proof attached.</p>';
      return;
    }
    box.innerHTML = attachments
      .map(
        (a) => `<div class="list-item">
          <strong>${esc(a.name)}</strong>
          <span class="meta">${esc(fmtWhen(a.createdAt))}</span>
          <div class="btn-row">
            <button type="button" class="secondary-btn att-dl" data-id="${esc(a.id)}">Open</button>
            <button type="button" class="danger-btn att-rm" data-id="${esc(a.id)}">Remove</button>
          </div>
        </div>`
      )
      .join('');
    box.querySelectorAll('.att-dl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const att = await getAttachment(btn.dataset.id);
        if (att?.blob) downloadBlob(att.name, att.blob);
      });
    });
    box.querySelectorAll('.att-rm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await deleteAttachment(btn.dataset.id);
        const i = attachments.findIndex((a) => a.id === btn.dataset.id);
        if (i >= 0) attachments.splice(i, 1);
        paintAtt();
      });
    });
  };
  paintAtt();

  const collect = () => ({
    id: heldId || undefined,
    workerId: root.querySelector('#oq-worker').value || null,
    workerName: root.querySelector('#oq-wname').value.trim(),
    employer: root.querySelector('#oq-emp').value.trim(),
    contractor: root.querySelector('#oq-con').value.trim(),
    foreman: root.querySelector('#oq-fore').value.trim(),
    taskNumber: root.querySelector('#oq-taskn').value.trim(),
    taskDesc: root.querySelector('#oq-taskd').value.trim(),
    status: root.querySelector('#oq-st').value,
    effectiveDate: root.querySelector('#oq-eff').value,
    expirationDate: root.querySelector('#oq-exp').value,
    evaluator: root.querySelector('#oq-eval').value.trim(),
    verificationSource: root.querySelector('#oq-src').value,
    verificationDatetime: root.querySelector('#oq-vdt').value,
    inspector: root.querySelector('#oq-insp').value.trim(),
    projectId: root.querySelector('#oq-proj').value || null,
    station: root.querySelector('#oq-sta').value.trim(),
    notes: root.querySelector('#oq-notes').value.trim(),
  });

  root.querySelector('#oq-file-add').addEventListener('click', async () => {
    const file = root.querySelector('#oq-file').files[0];
    if (!file) {
      status('Choose a file first.');
      return;
    }
    try {
      if (!heldId) {
        const saved = await putRecord('oqRecords', collect());
        heldId = saved.id;
        sessionStorage.setItem('uig:edit:oq-edit', heldId);
      }
      const att = await putAttachment({
        recordId: heldId,
        collection: 'oqRecords',
        name: file.name,
        mime: file.type,
        blob: file,
      });
      attachments.push(att);
      root.querySelector('#oq-file').value = '';
      paintAtt();
      status('Proof attached.');
    } catch (err) {
      status(err?.message || 'Attach failed.');
    }
  });

  root.querySelector('#oq-save').addEventListener('click', async () => {
    const data = collect();
    if (!data.workerId && !data.workerName) {
      status('Worker is required.');
      return;
    }
    if (!data.taskNumber && !data.taskDesc) {
      status('Task # or description is required.');
      return;
    }
    try {
      const saved = await putRecord('oqRecords', data);
      heldId = saved.id;
      sessionStorage.setItem('uig:edit:oq-edit', heldId);
      status('Saved on this device.');
      paintDisp();
    } catch (err) {
      status(err?.message || 'Save failed.');
    }
  });

  root.querySelector('#oq-del')?.addEventListener('click', async () => {
    if (!heldId) return;
    if (!confirm('Delete this OQ verification record?')) return;
    await deleteRecord('oqRecords', heldId);
    navigate('oq');
  });
}
