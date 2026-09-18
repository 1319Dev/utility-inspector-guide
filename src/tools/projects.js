/**
 * Projects — CRUD profiles, document list with CURRENT REVISION, set active.
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
import { getActiveProjectId, setActiveProjectId, projectLabel } from '../data/context.js';
import { esc, stickySave, complianceNote, fmtWhen } from '../ui/dom.js';
import { navigate, takeEditId } from '../ui/navigate.js';
import { downloadBlob } from '../store.js';

function blankProject() {
  const s = loadSettings();
  return {
    name: '',
    operator: '',
    inspectionCompany: '',
    contractors: '',
    chiefInspector: s.inspectorName || '',
    constructionManager: '',
    startDate: '',
    endDate: '',
    diameter: '',
    wallThickness: '',
    grade: '',
    coating: '',
    maop: '',
    limits: '',
    beginStation: '',
    endStation: '',
    county: '',
    state: '',
    projectNumber: '',
    woNumber: '',
    notes: '',
    documents: [],
  };
}

export async function mountProjects(root) {
  const [projects] = await Promise.all([listRecords('projects')]);
  const activeId = getActiveProjectId();

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>Projects</h3>
      <p class="muted">Profiles stay on this device. Set one active — Home, crew, and Start of Day use it.</p>
      <button type="button" class="primary-btn" id="proj-new">New project</button>
    </div>
    <div class="list" id="proj-list">
      ${
        projects.length
          ? projects
              .map(
                (p) => `
        <div class="list-item">
          <strong>${esc(projectLabel(p))}</strong>
          <span class="meta">${esc(p.operator || 'No operator')} · ${esc(p.county || '')} ${esc(p.state || '')}</span>
          ${p.id === activeId ? '<span class="status-pill status-green">ACTIVE</span>' : ''}
          <div class="btn-row">
            <button type="button" class="secondary-btn proj-open" data-id="${esc(p.id)}">Open</button>
            <button type="button" class="secondary-btn proj-active" data-id="${esc(p.id)}">${p.id === activeId ? 'Active' : 'Set active'}</button>
          </div>
        </div>`
              )
              .join('')
          : '<p class="muted">No projects yet.</p>'
      }
    </div>
  `;

  root.querySelector('#proj-new')?.addEventListener('click', () => navigate('project', { editId: '' }));
  root.querySelectorAll('.proj-open').forEach((btn) => {
    btn.addEventListener('click', () => navigate('project', { editId: btn.dataset.id }));
  });
  root.querySelectorAll('.proj-active').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await setActiveProjectId(btn.dataset.id);
      mountProjects(root);
    });
  });
}

export async function mountProjectEdit(root) {
  const id = takeEditId('project');
  const existing = id ? await getRecord('projects', id) : null;
  const p = { ...blankProject(), ...(existing || {}) };
  if (!p.documents) p.documents = [];
  const attachments = existing ? await listAttachments(existing.id) : [];
  let heldId = existing?.id || null;

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>${existing ? 'Edit project' : 'New project'}</h3>
      <button type="button" class="primary-btn" id="p-save-top">${existing ? 'Save project' : 'Create project'}</button>
      <div class="field"><label>Project name</label><input id="p-name" value="${esc(p.name)}" autocomplete="off" /></div>
      <div class="field"><label>Operator / client</label><input id="p-operator" value="${esc(p.operator)}" /></div>
      <div class="field"><label>Inspection company</label><input id="p-inspco" value="${esc(p.inspectionCompany)}" /></div>
      <div class="field"><label>Contractors</label><textarea id="p-contractors" rows="2">${esc(p.contractors)}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Chief inspector</label><input id="p-chief" value="${esc(p.chiefInspector)}" /></div>
        <div class="field"><label>Construction manager</label><input id="p-cm" value="${esc(p.constructionManager)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Start date</label><input id="p-start" type="date" value="${esc(p.startDate)}" /></div>
        <div class="field"><label>End date</label><input id="p-end" type="date" value="${esc(p.endDate)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Diameter</label><input id="p-dia" value="${esc(p.diameter)}" placeholder='e.g. 12"' /></div>
        <div class="field"><label>Wall thickness</label><input id="p-wt" value="${esc(p.wallThickness)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Grade</label><input id="p-grade" value="${esc(p.grade)}" /></div>
        <div class="field"><label>Coating</label><input id="p-coat" value="${esc(p.coating)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>MAOP</label><input id="p-maop" value="${esc(p.maop)}" /></div>
        <div class="field"><label>Limits</label><input id="p-limits" value="${esc(p.limits)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Begin station</label><input id="p-bsta" value="${esc(p.beginStation)}" inputmode="decimal" /></div>
        <div class="field"><label>End station</label><input id="p-esta" value="${esc(p.endStation)}" inputmode="decimal" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>County</label><input id="p-county" value="${esc(p.county)}" /></div>
        <div class="field"><label>State</label><input id="p-state" value="${esc(p.state)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Project #</label><input id="p-pno" value="${esc(p.projectNumber)}" /></div>
        <div class="field"><label>WO #</label><input id="p-wo" value="${esc(p.woNumber)}" /></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="p-notes" rows="3">${esc(p.notes)}</textarea></div>
    </div>

    <div class="card" id="p-docs-card">
      <h3>Documents</h3>
      <p class="muted">Attach specs / SOW / drawings (IndexedDB). Flag one current revision per title.</p>
      <div class="field"><label>Title</label><input id="p-doc-title" placeholder="e.g. Scope of Work" /></div>
      <div class="field-row">
        <div class="field"><label>Revision</label><input id="p-doc-rev" placeholder="Rev C" /></div>
        <div class="field"><label>Current revision</label>
          <label class="check-item" style="margin-top:6px"><input type="checkbox" id="p-doc-cur" checked /> CURRENT</label>
        </div>
      </div>
      <div class="field"><label>File (optional)</label><input id="p-doc-file" type="file" /></div>
      <button type="button" class="secondary-btn" id="p-doc-add">Add document</button>
      <div class="list" id="p-doc-list"></div>
    </div>

    ${stickySave('p-save', existing ? 'Save project' : 'Create project')}
    ${
      existing
        ? `<div class="btn-row"><button type="button" class="secondary-btn" id="p-active">Set as active</button>
           <button type="button" class="danger-btn" id="p-del">Delete</button></div>`
        : ''
    }
    <p class="muted">Updated ${esc(fmtWhen(p.updatedAt))}</p>
  `;

  const docs = [...(p.documents || [])];

  const renderDocs = () => {
    const box = root.querySelector('#p-doc-list');
    if (!docs.length) {
      box.innerHTML = '<p class="muted">No documents yet.</p>';
      return;
    }
    box.innerHTML = docs
      .map((d, i) => {
        const att = attachments.find((a) => a.id === d.attachmentId);
        return `<div class="list-item">
          <strong>${esc(d.title)}</strong>
          <span class="meta">Rev ${esc(d.revision || '—')} ${d.current ? '· CURRENT REVISION' : ''} ${att ? `· ${esc(att.name)}` : ''}</span>
          <div class="btn-row">
            <button type="button" class="secondary-btn doc-cur" data-i="${i}">${d.current ? 'Current' : 'Make current'}</button>
            ${d.attachmentId ? `<button type="button" class="secondary-btn doc-dl" data-att="${esc(d.attachmentId)}">Open file</button>` : ''}
            <button type="button" class="danger-btn doc-rm" data-i="${i}">Remove</button>
          </div>
        </div>`;
      })
      .join('');

    box.querySelectorAll('.doc-cur').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        const title = docs[i].title;
        docs.forEach((d) => {
          if (d.title === title) d.current = false;
        });
        docs[i].current = true;
        renderDocs();
      });
    });
    box.querySelectorAll('.doc-rm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.i);
        const attId = docs[i].attachmentId;
        docs.splice(i, 1);
        if (attId) {
          try {
            await deleteAttachment(attId);
          } catch {
            /* ignore */
          }
        }
        renderDocs();
      });
    });
    box.querySelectorAll('.doc-dl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const att = await getAttachment(btn.dataset.att);
        if (att?.blob) downloadBlob(att.name, att.blob);
      });
    });
  };
  renderDocs();

  const collect = () => ({
    name: root.querySelector('#p-name').value.trim(),
    operator: root.querySelector('#p-operator').value.trim(),
    inspectionCompany: root.querySelector('#p-inspco').value.trim(),
    contractors: root.querySelector('#p-contractors').value.trim(),
    chiefInspector: root.querySelector('#p-chief').value.trim(),
    constructionManager: root.querySelector('#p-cm').value.trim(),
    startDate: root.querySelector('#p-start').value,
    endDate: root.querySelector('#p-end').value,
    diameter: root.querySelector('#p-dia').value.trim(),
    wallThickness: root.querySelector('#p-wt').value.trim(),
    grade: root.querySelector('#p-grade').value.trim(),
    coating: root.querySelector('#p-coat').value.trim(),
    maop: root.querySelector('#p-maop').value.trim(),
    limits: root.querySelector('#p-limits').value.trim(),
    beginStation: root.querySelector('#p-bsta').value.trim(),
    endStation: root.querySelector('#p-esta').value.trim(),
    county: root.querySelector('#p-county').value.trim(),
    state: root.querySelector('#p-state').value.trim(),
    projectNumber: root.querySelector('#p-pno').value.trim(),
    woNumber: root.querySelector('#p-wo').value.trim(),
    notes: root.querySelector('#p-notes').value.trim(),
    documents: docs,
  });

  const status = (msg) => {
    const el = root.querySelector('#p-save-status');
    if (el) el.textContent = msg || '';
  };

  root.querySelector('#p-doc-add')?.addEventListener('click', async () => {
    const title = root.querySelector('#p-doc-title').value.trim();
    if (!title) {
      status('Document needs a title.');
      return;
    }
    const revision = root.querySelector('#p-doc-rev').value.trim();
    const current = root.querySelector('#p-doc-cur').checked;
    const file = root.querySelector('#p-doc-file').files[0];
    let recordId = heldId;
    if (!recordId) {
      const created = await putRecord('projects', { ...collect(), documents: docs });
      recordId = created.id;
      sessionStorage.setItem('uig:edit:project', recordId);
      heldId = recordId;
    }
    let attachmentId = null;
    if (file) {
      try {
        const att = await putAttachment({
          recordId,
          collection: 'projects',
          name: file.name,
          mime: file.type,
          blob: file,
        });
        attachmentId = att.id;
        attachments.push(att);
      } catch (err) {
        status(err?.message || 'File attach failed.');
        return;
      }
    }
    if (current) {
      docs.forEach((d) => {
        if (d.title === title) d.current = false;
      });
    }
    docs.push({
      id: `doc-${Date.now().toString(36)}`,
      title,
      revision,
      current,
      attachmentId,
    });
    root.querySelector('#p-doc-title').value = '';
    root.querySelector('#p-doc-rev').value = '';
    root.querySelector('#p-doc-file').value = '';
    renderDocs();
    status('Document added — tap Save project to persist the list.');
  });

  root.querySelector('#p-save')?.addEventListener('click', saveProject);
  root.querySelector('#p-save-top')?.addEventListener('click', saveProject);

  async function saveProject() {
    try {
      const data = collect();
      if (!data.name) {
        status('Name is required.');
        return;
      }
      const saved = await putRecord('projects', { ...data, id: heldId || undefined, documents: docs });
      heldId = saved.id;
      sessionStorage.setItem('uig:edit:project', saved.id);
      if (!getActiveProjectId()) await setActiveProjectId(saved.id);
      status('Saved on this device.');
    } catch (err) {
      status(err?.message || 'Save failed.');
    }
  }

  root.querySelector('#p-active')?.addEventListener('click', async () => {
    if (heldId) {
      await setActiveProjectId(heldId);
      status('This project is active.');
    }
  });

  root.querySelector('#p-del')?.addEventListener('click', async () => {
    if (!heldId) return;
    if (!confirm('Delete this project profile? Crew / OQ records keep their projectId.')) return;
    await deleteRecord('projects', heldId);
    if (getActiveProjectId() === heldId) await setActiveProjectId(null);
    navigate('projects');
  });
}
