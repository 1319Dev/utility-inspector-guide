/**
 * Record CRUD for compliance collections.
 * Shape: id, orgId, projectId, createdAt, updatedAt, createdBy, syncStatus
 */
import { uid, loadSettings } from '../store.js';
import { LOCAL_ORG_ID, SYNC_LOCAL, SYNC_PENDING, SYNC_ERROR, MAX_ATTACH_BYTES } from './constants.js';
import { idbPut, idbGet, idbGetAll, idbDelete, idbGetByIndex } from './idb.js';
import { notifySaving, notifySavedLocal, reportQuotaError } from './sync.js';

function nowIso() {
  return new Date().toISOString();
}

function actor() {
  return loadSettings().inspectorName || 'inspector';
}

export function baseRecord(partial = {}) {
  const ts = nowIso();
  return {
    id: partial.id || uid(),
    orgId: partial.orgId || LOCAL_ORG_ID,
    projectId: partial.projectId ?? null,
    createdAt: partial.createdAt || ts,
    updatedAt: ts,
    createdBy: partial.createdBy || actor(),
    syncStatus: partial.syncStatus || SYNC_LOCAL,
  };
}

async function enqueue(collection, recordId, op) {
  const item = {
    id: uid(),
    collection,
    recordId,
    op,
    at: nowIso(),
    status: 'pending',
    error: null,
  };
  try {
    await idbPut('syncQueue', item);
  } catch (err) {
    /* queue is best-effort; the record itself is the source of truth */
    console.warn('syncQueue write failed', err);
  }
}

export async function putRecord(collection, data) {
  notifySaving();
  const prev = data.id ? await idbGet(collection, data.id) : null;
  const base = baseRecord({
    ...prev,
    ...data,
    createdAt: prev?.createdAt,
    createdBy: prev?.createdBy || data.createdBy,
  });
  const record = {
    ...base,
    ...data,
    id: data.id || prev?.id || base.id,
    updatedAt: nowIso(),
    syncStatus: SYNC_PENDING,
  };
  try {
    await idbPut(collection, record);
    await enqueue(collection, record.id, 'put');
    notifySavedLocal();
    return record;
  } catch (err) {
    record.syncStatus = SYNC_ERROR;
    if (err?.name !== 'QuotaExceededError') {
      reportQuotaError(err, { store: collection, id: record.id });
    }
    throw err;
  }
}

export async function getRecord(collection, id) {
  if (!id) return null;
  return idbGet(collection, id);
}

export async function listRecords(collection) {
  const rows = await idbGetAll(collection);
  return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function listByProject(collection, projectId) {
  if (!projectId) return listRecords(collection);
  const rows = await idbGetByIndex(collection, 'projectId', projectId);
  return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function deleteRecord(collection, id) {
  notifySaving();
  try {
    const atts = await idbGetByIndex('attachments', 'recordId', id);
    for (const a of atts) {
      await idbDelete('attachments', a.id);
    }
    await idbDelete(collection, id);
    await enqueue(collection, id, 'delete');
    notifySavedLocal();
  } catch (err) {
    reportQuotaError(err, { store: collection, id });
    throw err;
  }
}

export async function listPendingQueue() {
  try {
    return await idbGetByIndex('syncQueue', 'status', 'pending');
  } catch {
    return [];
  }
}

export async function putAttachment({ recordId, collection, name, mime, blob }) {
  if (blob && blob.size > MAX_ATTACH_BYTES) {
    const err = new Error(`File too large (${Math.round(blob.size / 1024 / 1024)} MB). Max 8 MB.`);
    reportQuotaError(err, { store: 'attachments' });
    throw err;
  }
  notifySaving();
  const row = {
    id: uid(),
    recordId,
    collection,
    name: name || 'file',
    mime: mime || blob?.type || 'application/octet-stream',
    size: blob?.size || 0,
    blob,
    createdAt: nowIso(),
  };
  try {
    await idbPut('attachments', row);
    notifySavedLocal();
    return row;
  } catch (err) {
    if (err?.name !== 'QuotaExceededError') {
      reportQuotaError(err, { store: 'attachments' });
    }
    throw err;
  }
}

export async function getAttachment(id) {
  return idbGet('attachments', id);
}

export async function listAttachments(recordId) {
  return idbGetByIndex('attachments', 'recordId', recordId);
}

export async function deleteAttachment(id) {
  await idbDelete('attachments', id);
}

export async function getMeta(id) {
  return idbGet('meta', id);
}

export async function setMeta(id, value) {
  return idbPut('meta', { id, ...value, updatedAt: nowIso() });
}
