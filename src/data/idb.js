/**
 * IndexedDB backing store for compliance records and attachments.
 * Scope of Work and Station Locator keep their own DBs.
 */
import { RECORD_STORES } from './constants.js';
import { reportQuotaError, reportSyncState } from './sync.js';

export const DB_NAME = 'uig-compliance';
export const DB_VER = 1;

const ALL_STORES = [...RECORD_STORES, 'attachments', 'syncQueue', 'meta'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of RECORD_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('orgId', 'orgId', { unique: false });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('syncStatus', 'syncStatus', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('attachments')) {
        const att = db.createObjectStore('attachments', { keyPath: 'id' });
        att.createIndex('recordId', 'recordId', { unique: false });
        att.createIndex('collection', 'collection', { unique: false });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        const q = db.createObjectStore('syncQueue', { keyPath: 'id' });
        q.createIndex('status', 'status', { unique: false });
        q.createIndex('collection', 'collection', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('IndexedDB open failed'));
    };
    req.onblocked = () => {
      /* another tab holds old version */
    };
  });
  return dbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function isQuota(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = String(err.message || err);
  return name === 'QuotaExceededError' || /quota/i.test(msg);
}

export async function idbPut(storeName, value) {
  try {
    const db = await openDb();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    await txDone(tx);
    return value;
  } catch (err) {
    if (isQuota(err)) {
      reportQuotaError(err, { store: storeName, id: value?.id });
    }
    throw err;
  }
}

export async function idbGet(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const row = await requestToPromise(tx.objectStore(storeName).get(id));
  await txDone(tx).catch(() => {});
  return row || null;
}

export async function idbGetAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const rows = await requestToPromise(tx.objectStore(storeName).getAll());
  await txDone(tx).catch(() => {});
  return rows || [];
}

export async function idbDelete(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

export async function idbGetByIndex(storeName, indexName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const idx = tx.objectStore(storeName).index(indexName);
  const rows = await requestToPromise(idx.getAll(value));
  await txDone(tx).catch(() => {});
  return rows || [];
}

export { ALL_STORES, openDb };

export async function ensureDb() {
  try {
    await openDb();
    reportSyncState(navigator.onLine ? 'online' : 'offline');
    return true;
  } catch (err) {
    reportQuotaError(err, { store: 'open' });
    return false;
  }
}
