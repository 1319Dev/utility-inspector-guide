/**
 * Materials Check-In — packing-list import, manual lines, field receipts, .xlsx export.
 * Local-only IndexedDB (packingLists, materials, materialCheckins).
 */
import { getGps, fmtGps } from '../store.js';
import { listByProject, listRecords, putRecord, deleteRecord } from '../data/records.js';
import { getActiveProject, getActiveProjectId, projectLabel } from '../data/context.js';
import { parseQty, lineProgress, CHECKIN_STATUSES } from '../data/materials.js';
import { esc, stickySave, complianceNote, statusPill, fmtWhen } from '../ui/dom.js';
import {
  MATERIAL_FIELDS,
  parsePackingFile,
  rowsFromMapping,
  exportDefaultMaterialsXlsx,
} from './materialsIo.js';

/** Re-export so a future company-template exporter can share this mount module. */
export { exportCompanyMaterialsXlsx } from './materialsIo.js';

const FILE_ACCEPT =
  '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/comma-separated-values';

function localDatetimeValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function eventsFor(lineId, events) {
  return events.filter((ev) => ev.materialId === lineId);
}

export async function mountMaterials(root) {
  const project = await getActiveProject();
  const projectId = getActiveProjectId();

  let packingLists = [];
  let lines = [];
  let events = [];
  let selectedId = null;
  let filter = 'all';
  let search = '';
  let listFilter = '';
  let pendingImport = null;
  let gps = null;
  let checkStatus = 'ok';
  let lastCheckinMsg = '';

  root.innerHTML = `
    ${complianceNote()}
    <p class="muted">${project ? esc(projectLabel(project)) : 'No active project — lines still save on this device.'}</p>

    <div class="card">
      <h3>Import packing list</h3>
      <p class="muted">Freeform Excel (.xlsx / .xls) or CSV. Columns are mapped by header names; you can adjust if they look wrong.</p>
      <label class="sow-drop" id="mat-drop">
        <input type="file" id="mat-file" accept="${FILE_ACCEPT}" hidden />
        <span class="sow-drop-title">Tap to choose file</span>
        <span class="muted">Works on iPhone Files / Files app</span>
      </label>
      <button type="button" class="primary-btn" id="mat-import-btn">Choose packing list</button>
      <p class="muted" id="mat-import-status" role="status"></p>
    </div>

    <div class="card" id="mat-map-card" hidden>
      <h3>Confirm column mapping</h3>
      <p class="muted" id="mat-map-lead"></p>
      <div id="mat-map-fields"></div>
      <div class="btn-row">
        <button type="button" class="primary-btn" id="mat-map-go">Import lines</button>
        <button type="button" class="secondary-btn" id="mat-map-cancel">Cancel</button>
      </div>
    </div>

    <div class="card">
      <h3>Add material line</h3>
      <div class="field"><label for="mat-desc">Item / description</label>
        <input id="mat-desc" autocomplete="off" placeholder='e.g. 12" X52 pipe' />
      </div>
      <div class="field-row">
        <div class="field"><label for="mat-qty">Expected qty</label>
          <input id="mat-qty" type="number" inputmode="decimal" placeholder="optional" />
        </div>
        <div class="field"><label for="mat-unit">Unit</label>
          <input id="mat-unit" autocomplete="off" placeholder="jt / ft / ea" />
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label for="mat-heat">Heat #</label>
          <input id="mat-heat" autocomplete="off" />
        </div>
        <div class="field"><label for="mat-po">PO #</label>
          <input id="mat-po" autocomplete="off" />
        </div>
      </div>
      <div class="field"><label for="mat-size">Size / diameter</label>
        <input id="mat-size" autocomplete="off" />
      </div>
      <div class="field"><label for="mat-notes">Line notes</label>
        <textarea id="mat-notes" rows="2"></textarea>
      </div>
      <button type="button" class="primary-btn" id="mat-add">Add line</button>
      <p class="muted" id="mat-add-status" role="status"></p>
    </div>

    <div class="card">
      <h3>Materials log</h3>
      <div class="field"><label for="mat-search">Search</label>
        <input id="mat-search" type="search" enterkeyhint="search" placeholder="Item, heat, PO, location…" autocomplete="off" />
      </div>
      <div class="field"><label for="mat-list-filter">Packing list</label>
        <select id="mat-list-filter"></select>
      </div>
      <div class="segment" id="mat-filter" role="tablist" aria-label="Filter lines">
        <button type="button" class="active" data-filter="all">All</button>
        <button type="button" data-filter="open">Open</button>
        <button type="button" data-filter="complete">Done</button>
      </div>
      <div id="mat-list" class="list"></div>
    </div>

    <div class="card" id="mat-detail" hidden></div>

    ${stickySave('mat-export', 'Export Excel (.xlsx)')}
  `;

  const importStatus = (msg) => {
    const el = root.querySelector('#mat-import-status');
    if (el) el.textContent = msg || '';
  };
  const addStatus = (msg) => {
    const el = root.querySelector('#mat-add-status');
    if (el) el.textContent = msg || '';
  };
  const exportStatus = (msg) => {
    const el = root.querySelector('#mat-export-status');
    if (el) el.textContent = msg || '';
  };

  async function loadAll() {
    const [lists, mats, evs] = await Promise.all([
      projectId ? listByProject('packingLists', projectId) : listRecords('packingLists'),
      projectId ? listByProject('materials', projectId) : listRecords('materials'),
      projectId ? listByProject('materialCheckins', projectId) : listRecords('materialCheckins'),
    ]);
    packingLists = lists;
    lines = mats.sort((a, b) => String(a.description || '').localeCompare(String(b.description || '')));
    events = evs;
  }

  function paintListFilter() {
    const sel = root.querySelector('#mat-list-filter');
    const opts = [
      `<option value="">All packing lists</option>`,
      ...packingLists.map(
        (p) =>
          `<option value="${esc(p.id)}"${p.id === listFilter ? ' selected' : ''}>${esc(
            p.name || p.filename || 'Untitled list'
          )}</option>`
      ),
    ];
    sel.innerHTML = opts.join('');
  }

  function visibleLines() {
    const q = search.trim().toLowerCase();
    return lines.filter((line) => {
      if (listFilter && line.packingListId !== listFilter) return false;
      const evs = eventsFor(line.id, events);
      const prog = lineProgress(line, evs);
      if (filter === 'open' && prog.complete) return false;
      if (filter === 'complete' && !prog.complete) return false;
      if (!q) return true;
      const last = prog.last;
      const hay = [
        line.description,
        line.heatNumber,
        line.poNumber,
        line.size,
        line.notes,
        line.unit,
        last?.location,
        last?.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function paintLines() {
    const box = root.querySelector('#mat-list');
    const shown = visibleLines();
    if (!shown.length) {
      box.innerHTML = `<p class="muted">${
        lines.length ? 'No lines match this search / filter.' : 'No material lines yet. Import a packing list or add one by hand.'
      }</p>`;
      return;
    }
    box.innerHTML = shown
      .map((line) => {
        const evs = eventsFor(line.id, events);
        const prog = lineProgress(line, evs);
        const pill = statusPill(
          prog.status.id === 'ok' ? 'ok' : prog.status.id === 'short' ? 'warn' : prog.status.id === 'idle' ? 'idle' : 'expired',
          prog.status.label
        );
        const rem =
          prog.remaining == null ? '—' : prog.remaining <= 0 ? '0' : String(prog.remaining);
        const open = line.id === selectedId ? ' is-open' : '';
        return `<button type="button" class="list-item list-btn mat-line${open}" data-id="${esc(line.id)}">
          <strong>${esc(line.description)}</strong>
          <span class="meta">${pill} · ${esc(line.unit || 'qty')} exp ${prog.expected ?? '—'} · recv ${prog.received} · left ${rem}</span>
          ${line.heatNumber || line.poNumber ? `<span class="meta">${line.heatNumber ? `Heat ${esc(line.heatNumber)}` : ''}${line.heatNumber && line.poNumber ? ' · ' : ''}${line.poNumber ? `PO ${esc(line.poNumber)}` : ''}</span>` : ''}
        </button>`;
      })
      .join('');
  }

  function paintDetail() {
    const card = root.querySelector('#mat-detail');
    const line = lines.find((l) => l.id === selectedId);
    if (!line) {
      card.hidden = true;
      card.innerHTML = '';
      return;
    }
    const evs = eventsFor(line.id, events).sort((a, b) =>
      String(b.when || '').localeCompare(String(a.when || ''))
    );
    const prog = lineProgress(line, evs);
    const list = packingLists.find((p) => p.id === line.packingListId);
    card.hidden = false;
    card.innerHTML = `
      <h3>Check in</h3>
      <p class="muted">${esc(line.description)}${list ? ` · ${esc(list.name || list.filename)}` : ''}</p>
      <div class="mat-qty-row">
        <div class="mat-qty-cell"><span class="muted">Expected</span><strong>${prog.expected ?? '—'}</strong></div>
        <div class="mat-qty-cell"><span class="muted">Received</span><strong>${prog.received}</strong></div>
        <div class="mat-qty-cell"><span class="muted">Remaining</span><strong>${prog.remaining ?? '—'}</strong></div>
      </div>
      <label class="check-item">
        <input type="checkbox" id="ci-complete" ${prog.complete ? 'checked' : ''} />
        <span>Mark line complete${prog.expected != null && prog.received >= prog.expected ? ' (qty met)' : ' (override)'}</span>
      </label>
      <div class="field"><label for="ci-qty">Received qty this drop</label>
        <input id="ci-qty" type="number" inputmode="decimal" />
      </div>
      <div class="field"><label for="ci-when">When</label>
        <input id="ci-when" type="datetime-local" value="${esc(localDatetimeValue())}" />
      </div>
      <div class="field"><label for="ci-loc">Location / station</label>
        <input id="ci-loc" autocomplete="off" placeholder="Sta 12+45 / yard / laydown" />
      </div>
      <div class="btn-row">
        <button type="button" class="secondary-btn" id="ci-gps">Use GPS</button>
      </div>
      <p class="muted" id="ci-gps-label">${gps ? esc(fmtGps(gps)) : 'GPS optional'}</p>
      <div class="field"><label>Status</label>
        <div class="segment" id="ci-status">
          ${CHECKIN_STATUSES.map(
            (s) =>
              `<button type="button"${s.id === checkStatus ? ' class="active"' : ''} data-st="${esc(s.id)}">${esc(s.label)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field"><label for="ci-notes">Check-in notes</label>
        <textarea id="ci-notes" rows="2" placeholder="Damage, short truck, heat mismatch…"></textarea>
      </div>
      <button type="button" class="primary-btn" id="ci-save">Save check-in</button>
      <p class="muted" id="ci-save-status" role="status">${esc(lastCheckinMsg)}</p>
      <h3>History</h3>
      <div class="list" id="ci-hist">
        ${
          evs.length
            ? evs
                .map(
                  (ev) => `<div class="list-item">
                    <strong>${esc(String(parseQty(ev.receivedQty) ?? '—'))} · ${esc(
                      CHECKIN_STATUSES.find((s) => s.id === ev.status)?.label || ev.status || '—'
                    )}</strong>
                    <span class="meta">${esc(fmtWhen(ev.when))}${ev.location ? ` · ${esc(ev.location)}` : ''}</span>
                    ${ev.notes ? `<span class="meta">${esc(ev.notes)}</span>` : ''}
                    <button type="button" class="danger-btn ci-del" data-id="${esc(ev.id)}">Delete event</button>
                  </div>`
                )
                .join('')
            : '<p class="muted">No check-ins yet on this line.</p>'
        }
      </div>
      <button type="button" class="danger-btn" id="mat-del-line">Delete line</button>
    `;

    card.querySelector('#ci-status')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-st]');
      if (!btn) return;
      checkStatus = btn.dataset.st;
      card.querySelectorAll('#ci-status button').forEach((b) => b.classList.toggle('active', b === btn));
    });

    card.querySelector('#ci-complete')?.addEventListener('change', async (e) => {
      const checked = e.target.checked;
      const expected = parseQty(line.expectedQty);
      const auto = expected != null && prog.received >= expected;
      try {
        await putRecord('materials', {
          ...line,
          complete: checked,
          completeOverride: auto ? !checked : checked,
        });
        await loadAll();
        paintLines();
        paintDetail();
      } catch (err) {
        const st = card.querySelector('#ci-save-status');
        if (st) st.textContent = err?.message || 'Could not update complete flag.';
      }
    });

    card.querySelector('#ci-gps')?.addEventListener('click', async () => {
      const label = card.querySelector('#ci-gps-label');
      if (label) label.textContent = 'Getting GPS…';
      gps = await getGps();
      if (label) label.textContent = gps ? fmtGps(gps) : 'GPS unavailable — location text still works.';
    });

    card.querySelector('#ci-save')?.addEventListener('click', saveCheckin);
    card.querySelector('#mat-del-line')?.addEventListener('click', deleteLine);
    card.querySelectorAll('.ci-del').forEach((btn) => {
      btn.addEventListener('click', () => deleteEvent(btn.dataset.id));
    });
  }

  async function saveCheckin() {
    const card = root.querySelector('#mat-detail');
    const line = lines.find((l) => l.id === selectedId);
    const statusEl = card.querySelector('#ci-save-status');
    if (!line) return;
    const qty = parseQty(card.querySelector('#ci-qty')?.value);
    if (qty == null) {
      statusEl.textContent = 'Enter the received quantity for this drop.';
      return;
    }
    const whenVal = card.querySelector('#ci-when')?.value;
    const when = whenVal ? new Date(whenVal).toISOString() : new Date().toISOString();
    try {
      await putRecord('materialCheckins', {
        projectId: line.projectId || projectId || null,
        materialId: line.id,
        packingListId: line.packingListId || null,
        receivedQty: qty,
        when,
        location: card.querySelector('#ci-loc')?.value.trim() || '',
        lat: gps?.lat ?? null,
        lon: gps?.lon ?? null,
        status: checkStatus,
        notes: card.querySelector('#ci-notes')?.value.trim() || '',
      });
      const evs = [
        ...eventsFor(line.id, events),
        { receivedQty: qty, status: checkStatus, when },
      ];
      const prog = lineProgress(line, evs);
      if (prog.complete && !line.complete && !line.completeOverride) {
        await putRecord('materials', { ...line, complete: true, completeOverride: false });
      }
      lastCheckinMsg = 'Check-in saved.';
      statusEl.textContent = lastCheckinMsg;
      await loadAll();
      paintListFilter();
      paintLines();
      paintDetail();
    } catch (err) {
      statusEl.textContent = err?.message || 'Check-in failed.';
    }
  }

  async function deleteEvent(id) {
    try {
      await deleteRecord('materialCheckins', id);
      await loadAll();
      paintLines();
      paintDetail();
    } catch (err) {
      const st = root.querySelector('#ci-save-status');
      if (st) st.textContent = err?.message || 'Delete failed.';
    }
  }

  async function deleteLine() {
    const line = lines.find((l) => l.id === selectedId);
    if (!line) return;
    try {
      for (const ev of eventsFor(line.id, events)) {
        await deleteRecord('materialCheckins', ev.id);
      }
      await deleteRecord('materials', line.id);
      selectedId = null;
      await loadAll();
      paintListFilter();
      paintLines();
      paintDetail();
      addStatus('Line deleted.');
    } catch (err) {
      addStatus(err?.message || 'Delete failed.');
    }
  }

  async function ensureManualList() {
    const match = packingLists.find(
      (p) => p.source === 'manual' && (p.projectId || null) === (projectId || null)
    );
    if (match) return match;
    return putRecord('packingLists', {
      projectId: projectId || null,
      name: 'Manual entries',
      filename: '',
      source: 'manual',
      importedAt: new Date().toISOString(),
    });
  }

  async function addManualLine() {
    const description = root.querySelector('#mat-desc').value.trim();
    if (!description) {
      addStatus('Enter an item / description.');
      return;
    }
    try {
      const list = listFilter
        ? packingLists.find((p) => p.id === listFilter) || (await ensureManualList())
        : await ensureManualList();
      const saved = await putRecord('materials', {
        projectId: projectId || null,
        packingListId: list.id,
        description,
        expectedQty: parseQty(root.querySelector('#mat-qty').value),
        unit: root.querySelector('#mat-unit').value.trim(),
        heatNumber: root.querySelector('#mat-heat').value.trim(),
        poNumber: root.querySelector('#mat-po').value.trim(),
        size: root.querySelector('#mat-size').value.trim(),
        notes: root.querySelector('#mat-notes').value.trim(),
        complete: false,
        completeOverride: false,
      });
      root.querySelector('#mat-desc').value = '';
      root.querySelector('#mat-qty').value = '';
      root.querySelector('#mat-notes').value = '';
      selectedId = saved.id;
      addStatus('Line added.');
      await loadAll();
      paintListFilter();
      paintLines();
      paintDetail();
      root.querySelector('#mat-detail')?.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      addStatus(err?.message || 'Could not add line.');
    }
  }

  function hideMapping() {
    pendingImport = null;
    root.querySelector('#mat-map-card').hidden = true;
  }

  function showMapping(parsed) {
    pendingImport = parsed;
    const card = root.querySelector('#mat-map-card');
    card.hidden = false;
    root.querySelector('#mat-map-lead').textContent =
      `${parsed.filename} · ${parsed.dataRows.length} data row(s). Confirm which columns to use.`;
    root.querySelector('#mat-map-fields').innerHTML = MATERIAL_FIELDS.map((field) => {
      const selected = parsed.map[field.key] ?? -1;
      const options = [
        `<option value="-1"${selected === -1 ? ' selected' : ''}>— skip —</option>`,
        ...parsed.headers.map(
          (h, i) =>
            `<option value="${i}"${i === selected ? ' selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`
        ),
      ].join('');
      return `<div class="field"><label for="map-${field.key}">${esc(field.label)}</label>
        <select id="map-${field.key}">${options}</select>
      </div>`;
    }).join('');
    if (parsed.preview?.length) {
      const preview = parsed.preview
        .map((row) => esc(row.map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 5).join(' · ')))
        .join('<br>');
      root.querySelector('#mat-map-fields').insertAdjacentHTML(
        'beforeend',
        `<p class="muted">Preview:<br>${preview}</p>`
      );
    }
    card.scrollIntoView({ block: 'nearest' });
  }

  function readMappingFromForm() {
    const map = {};
    for (const field of MATERIAL_FIELDS) {
      const sel = root.querySelector(`#map-${field.key}`);
      map[field.key] = sel ? Number(sel.value) : -1;
    }
    return map;
  }

  async function commitImport(parsed, map) {
    const { lines: incoming, skipped } = rowsFromMapping(parsed.dataRows, map);
    if (!incoming.length) {
      importStatus('No usable lines — need an Item / Description column with values.');
      return;
    }
    try {
      const list = await putRecord('packingLists', {
        projectId: projectId || null,
        name: parsed.filename.replace(/\.[^.]+$/, '') || 'Packing list',
        filename: parsed.filename,
        source: 'import',
        importedAt: new Date().toISOString(),
        sheetName: parsed.sheetName || '',
      });
      for (const row of incoming) {
        await putRecord('materials', {
          projectId: projectId || null,
          packingListId: list.id,
          description: row.description,
          expectedQty: row.expectedQty,
          unit: row.unit,
          heatNumber: row.heatNumber,
          poNumber: row.poNumber,
          size: row.size,
          notes: row.notes,
          complete: false,
          completeOverride: false,
        });
      }
      hideMapping();
      listFilter = list.id;
      await loadAll();
      paintListFilter();
      paintLines();
      importStatus(
        `Imported ${incoming.length} line(s) from ${parsed.filename}${skipped ? ` · skipped ${skipped} empty` : ''}.`
      );
    } catch (err) {
      importStatus(err?.message || 'Import failed.');
    }
  }

  async function handleFile(file) {
    if (!file) return;
    importStatus(`Reading ${file.name}…`);
    try {
      const parsed = await parsePackingFile(file);
      if (parsed.ambiguous) {
        importStatus('Headers need a quick confirm.');
        showMapping(parsed);
        return;
      }
      await commitImport(parsed, parsed.map);
    } catch (err) {
      importStatus(err?.message || 'Could not read that file.');
    } finally {
      const input = root.querySelector('#mat-file');
      if (input) input.value = '';
    }
  }

  root.querySelector('#mat-file').addEventListener('change', (e) => {
    handleFile(e.target.files?.[0]);
  });
  root.querySelector('#mat-import-btn').addEventListener('click', () => {
    root.querySelector('#mat-file').click();
  });
  root.querySelector('#mat-map-cancel').addEventListener('click', () => {
    hideMapping();
    importStatus('Import cancelled.');
  });
  root.querySelector('#mat-map-go').addEventListener('click', async () => {
    if (!pendingImport) return;
    await commitImport(pendingImport, readMappingFromForm());
  });
  root.querySelector('#mat-add').addEventListener('click', addManualLine);
  root.querySelector('#mat-search').addEventListener('input', (e) => {
    search = e.target.value;
    paintLines();
  });
  root.querySelector('#mat-list-filter').addEventListener('change', (e) => {
    listFilter = e.target.value;
    paintLines();
  });
  root.querySelector('#mat-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    root.querySelectorAll('#mat-filter button').forEach((b) => b.classList.toggle('active', b === btn));
    paintLines();
  });
  root.querySelector('#mat-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.mat-line');
    if (!btn) return;
    selectedId = btn.dataset.id;
    checkStatus = 'ok';
    paintLines();
    paintDetail();
    root.querySelector('#mat-detail')?.scrollIntoView({ block: 'nearest' });
  });
  root.querySelector('#mat-export').addEventListener('click', async () => {
    try {
      exportStatus('Building spreadsheet…');
      const eventsByLine = new Map();
      for (const line of lines) eventsByLine.set(line.id, eventsFor(line.id, events));
      await exportDefaultMaterialsXlsx({
        projectLabel: project ? projectLabel(project) : '',
        packingLists,
        lines,
        eventsByLine,
      });
      exportStatus('Downloaded materials-check-in.xlsx (default V1 layout).');
    } catch (err) {
      exportStatus(err?.message || 'Export failed.');
    }
  });

  await loadAll();
  paintListFilter();
  paintLines();
}
