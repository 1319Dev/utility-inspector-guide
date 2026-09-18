/**
 * Online/offline + local pending queue (no backend in this phase).
 * Banner states: ONLINE / OFFLINE – SAVED LOCALLY / SYNCING / SYNC COMPLETE
 */

export const SYNC_EVENT = 'uig:sync';
export const STORAGE_ERROR_EVENT = 'uig:storage-error';

/** @type {'online'|'offline'|'syncing'|'complete'|'error'} */
let bannerState = typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline';
let bannerMessage = '';
let completeTimer = 0;

export function getBannerState() {
  return { state: bannerState, message: bannerMessage, online: typeof navigator !== 'undefined' && navigator.onLine };
}

export function reportSyncState(state, message = '') {
  bannerState = state;
  bannerMessage = message || '';
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_EVENT, {
      detail: { state, message: bannerMessage, online: navigator.onLine },
    })
  );
}

export function reportQuotaError(err, meta = {}) {
  const message =
    err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || err))
      ? 'Save failed — device storage quota. Remove old photos or documents and try again.'
      : `Save failed${meta.store ? ` (${meta.store})` : ''}. Data was not written.`;
  reportSyncState('error', message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(STORAGE_ERROR_EVENT, {
        detail: { err, message, ...meta },
      })
    );
  }
}

export function notifySaving() {
  reportSyncState('syncing', 'Saving on this device…');
}

export function notifySavedLocal() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    reportSyncState('offline', 'Saved locally');
    return;
  }
  reportSyncState('complete', 'Saved on this device');
  if (completeTimer) clearTimeout(completeTimer);
  completeTimer = setTimeout(() => {
    reportSyncState(navigator.onLine ? 'online' : 'offline');
  }, 2200);
}

export function listenConnectivity() {
  if (typeof window === 'undefined') return;
  const bump = () => {
    if (bannerState === 'error' || bannerState === 'syncing') return;
    reportSyncState(navigator.onLine ? 'online' : 'offline');
  };
  window.addEventListener('online', bump);
  window.addEventListener('offline', bump);
  bump();
}

/**
 * Local-only "flush": pending queue stays pending for a future backend.
 * Marks the save complete without claiming a cloud sync.
 */
export async function flushPendingQueue(listPending) {
  const pending = typeof listPending === 'function' ? await listPending() : [];
  if (!pending.length) {
    reportSyncState(navigator.onLine ? 'online' : 'offline');
    return { flushed: 0 };
  }
  reportSyncState('syncing', 'Queue ready (local only — no cloud backend yet)');
  await new Promise((r) => setTimeout(r, 180));
  notifySavedLocal();
  return { flushed: 0, queued: pending.length };
}
