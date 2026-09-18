/**
 * Personnel — worker database, certs, attachments, search, expiration alerts.
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
import { CERT_TYPES } from '../data/constants.js';
import { certAlerts, daysUntil } from '../data/oq.js';
import { esc, stickySave, complianceNote, optionList, statusPill } from '../ui/dom.js';
import { navigate, takeEditId } from '../ui/navigate.js';
import { downloadBlob, uid } from '../store.js';

function blankWorker() {
  return {
    name: '',
    company: '',
    role: '',
    phone: '',
    employeeId: '',
    active: true,
    certifications: [],
    notes: '',
  };
}

export async function mountPersonnel(root) {
  const workers = await listRecords('workers');
  const alerts = certAlerts(workers);

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>Personnel</h3>
      <p class="muted">Crew database on this device. Inactive workers stay for history but drop off default crew pickers.</p>
      <div class="field"><label>Search</label><input id="w-search" placeholder="Name, company, role, ID" /></div>
      <div class="field">
        <label>Filter</label>
        <select id="w-filter">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
          <option value="alerts">Expiring / expired certs</option>
        </select>
      </div>
      <button type="button" class="primary-btn" id="w-new">Add worker</button>
    </div>
    ${
      alerts.length
        ? `<div class="card alert-card">
            <h3>Expiration alerts (90 days)</h3>
            <div class="list">${alerts
              .slice(0, 8)
              .map((a) => {
                const label = a.kind === 'expired' ? 'Expired' : `${a.days}d`;
                return `<button type="button" class="list-item list-btn w-open" data-id="${esc(a.worker.id)}">
                  <strong>${esc(a.worker.name)} · ${esc(a.cert.name || a.cert.type)}</strong>
                  <span class="meta">${statusPill(a.kind === 'expired' ? 'expired' : 'expiring_soon', label)}</span>
                </button>`;
              })
              .join('')}</div>
          </div>`
        : ''
    }
    <div class="list" id="w-list"></div>
  `;

  const paint = () => {
    const q = (root.querySelector('#w-search').value || '').trim().toLowerCase();
    const filter = root.querySelector('#w-filter').value;
    const alertIds = new Set(alerts.map((a) => a.worker.id));
    const rows = workers.filter((w) => {
      if (filter === 'active' && w.active === false) return false;
      if (filter === 'inactive' && w.active !== false) return false;
      if (filter === 'alerts' && !alertIds.has(w.id)) return false;
      if (!q) return true;
      const blob = `${w.name} ${w.company} ${w.role} ${w.employeeId}`.toLowerCase();
      return blob.includes(q);
    });
    const box = root.querySelector('#w-list');
    if (!rows.length) {
      box.innerHTML = '<p class="muted">No matching workers.</p>';
      return;
    }
    box.innerHTML = rows
      .map((w) => {
        const nCert = (w.certifications || []).length;
        return `<div class="list-item">
          <strong>${esc(w.name || 'Unnamed')}</strong>
          <span class="meta">${esc(w.company || '—')} · ${esc(w.role || '—')} · ${w.active === false ? 'Inactive' : 'Active'} · ${nCert} certs</span>
          <button type="button" class="secondary-btn w-open" data-id="${esc(w.id)}">Open</button>
        </div>`;
      })
      .join('');
    box.querySelectorAll('.w-open').forEach((btn) => {
      btn.addEventListener('click', () => navigate('worker', { editId: btn.dataset.id }));
    });
  };

  paint();
  root.querySelector('#w-search').addEventListener('input', paint);
  root.querySelector('#w-filter').addEventListener('change', paint);
  root.querySelector('#w-new').addEventListener('click', () => navigate('worker', { editId: '' }));
  root.querySelectorAll('.alert-card .w-open').forEach((btn) => {
    btn.addEventListener('click', () => navigate('worker', { editId: btn.dataset.id }));
  });
}

export async function mountWorkerEdit(root) {
  const id = takeEditId('worker');
  const existing = id ? await getRecord('workers', id) : null;
  const w = { ...blankWorker(), ...(existing || {}) };
  if (!Array.isArray(w.certifications)) w.certifications = [];
  const attachments = existing ? await listAttachments(existing.id) : [];
  let heldId = existing?.id || null;
  const s = loadSettings();

  const certBlock = (c, i) => `
    <div class="card cert-card" data-i="${i}">
      <div class="field"><label>Type</label>
        <select class="c-type">${optionList(CERT_TYPES, c.type)}</select>
      </div>
      <div class="field"><label>Name / #</label><input class="c-name" value="${esc(c.name || '')}" placeholder="Card or cert name" /></div>
      <div class="field-row">
        <div class="field"><label>Number</label><input class="c-num" value="${esc(c.number || '')}" /></div>
        <div class="field"><label>Expires</label><input class="c-exp" type="date" value="${esc(c.expires || '')}" /></div>
      </div>
      ${(() => {
        const d = daysUntil(c.expires);
        if (d == null) return '';
        if (d < 0) return statusPill('expired', `Expired ${Math.abs(d)}d ago`);
        if (d <= 90) return statusPill('expiring_soon', `${d}d remaining`);
        return '';
      })()}
      <button type="button" class="danger-btn c-rm" data-i="${i}">Remove cert</button>
    </div>`;

  const paintCerts = () => {
    const box = root.querySelector('#w-certs');
    box.innerHTML = w.certifications.length
      ? w.certifications.map(certBlock).join('')
      : '<p class="muted">No certifications listed.</p>';
    box.querySelectorAll('.c-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.certifications.splice(Number(btn.dataset.i), 1);
        paintCerts();
      });
    });
  };

  root.innerHTML = `
    ${complianceNote()}
    <div class="card">
      <h3>${existing ? 'Edit worker' : 'New worker'}</h3>
      <div class="field"><label>Name</label><input id="w-name" value="${esc(w.name)}" autocomplete="name" /></div>
      <div class="field-row">
        <div class="field"><label>Company</label><input id="w-co" value="${esc(w.company)}" /></div>
        <div class="field"><label>Role</label><input id="w-role" value="${esc(w.role)}" placeholder="Foreman, operator…" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input id="w-phone" type="tel" value="${esc(w.phone)}" /></div>
        <div class="field"><label>Employee ID</label><input id="w-eid" value="${esc(w.employeeId)}" /></div>
      </div>
      <label class="check-item"><input type="checkbox" id="w-active" ${w.active === false ? '' : 'checked'} /> Active</label>
      <div class="field"><label>Notes</label><textarea id="w-notes" rows="3">${esc(w.notes)}</textarea></div>
    </div>

    <div class="card">
      <h3>Certifications</h3>
      <p class="muted">OSHA, NCCER, AMPP/NACE, API, CPR, HAZWOPER, confined space, excavation CP, welding, operator creds, other.</p>
      <div id="w-certs"></div>
      <button type="button" class="secondary-btn" id="w-cert-add">Add certification</button>
    </div>

    <div class="card">
      <h3>Attachments</h3>
      <p class="muted">Cards / PDFs stored in IndexedDB (max 8 MB each).</p>
      <div class="field"><label>File</label><input id="w-file" type="file" /></div>
      <button type="button" class="secondary-btn" id="w-file-add">Attach</button>
      <div class="list" id="w-att-list"></div>
    </div>

    ${stickySave('w-save', existing ? 'Save worker' : 'Create worker')}
    ${existing ? `<button type="button" class="danger-btn" id="w-del">Delete worker</button>` : ''}
    <p class="muted">Recorded by ${esc(s.inspectorName || 'inspector')} on this device.</p>
  `;

  paintCerts();

  const paintAtt = () => {
    const box = root.querySelector('#w-att-list');
    if (!attachments.length) {
      box.innerHTML = '<p class="muted">No files.</p>';
      return;
    }
    box.innerHTML = attachments
      .map(
        (a) => `<div class="list-item">
          <strong>${esc(a.name)}</strong>
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

  const collectCerts = () => {
    const cards = [...root.querySelectorAll('.cert-card')];
    return cards.map((card) => ({
      id: w.certifications[Number(card.dataset.i)]?.id || uid(),
      type: card.querySelector('.c-type').value,
      name: card.querySelector('.c-name').value.trim(),
      number: card.querySelector('.c-num').value.trim(),
      expires: card.querySelector('.c-exp').value,
    }));
  };

  root.querySelector('#w-cert-add').addEventListener('click', () => {
    w.certifications = collectCerts();
    w.certifications.push({ id: uid(), type: 'osha', name: '', number: '', expires: '' });
    paintCerts();
  });

  const status = (msg) => {
    const el = root.querySelector('#w-save-status');
    if (el) el.textContent = msg || '';
  };

  const ensureId = async () => {
    if (heldId) return heldId;
    const created = await putRecord('workers', collect());
    heldId = created.id;
    sessionStorage.setItem('uig:edit:worker', heldId);
    return heldId;
  };

  const collect = () => ({
    id: heldId || undefined,
    name: root.querySelector('#w-name').value.trim(),
    company: root.querySelector('#w-co').value.trim(),
    role: root.querySelector('#w-role').value.trim(),
    phone: root.querySelector('#w-phone').value.trim(),
    employeeId: root.querySelector('#w-eid').value.trim(),
    active: root.querySelector('#w-active').checked,
    notes: root.querySelector('#w-notes').value.trim(),
    certifications: collectCerts(),
  });

  root.querySelector('#w-file-add').addEventListener('click', async () => {
    const file = root.querySelector('#w-file').files[0];
    if (!file) {
      status('Choose a file first.');
      return;
    }
    try {
      const recordId = await ensureId();
      const att = await putAttachment({
        recordId,
        collection: 'workers',
        name: file.name,
        mime: file.type,
        blob: file,
      });
      attachments.push(att);
      root.querySelector('#w-file').value = '';
      paintAtt();
      status('File attached.');
    } catch (err) {
      status(err?.message || 'Attach failed.');
    }
  });

  root.querySelector('#w-save').addEventListener('click', async () => {
    const data = collect();
    if (!data.name) {
      status('Name is required.');
      return;
    }
    try {
      const saved = await putRecord('workers', data);
      heldId = saved.id;
      sessionStorage.setItem('uig:edit:worker', heldId);
      status('Saved on this device.');
    } catch (err) {
      status(err?.message || 'Save failed.');
    }
  });

  root.querySelector('#w-del')?.addEventListener('click', async () => {
    if (!heldId) return;
    if (!confirm('Delete this worker? OQ records that name them will remain.')) return;
    await deleteRecord('workers', heldId);
    navigate('personnel');
  });
}
