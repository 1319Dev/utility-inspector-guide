import { SYNC_EVENT, STORAGE_ERROR_EVENT, getBannerState, reportSyncState, listenConnectivity } from '../data/sync.js';

const LABELS = {
  online: 'ONLINE',
  offline: 'OFFLINE – SAVED LOCALLY',
  syncing: 'SYNCING',
  complete: 'SYNC COMPLETE',
  error: 'SAVE FAILED',
};

export function mountSyncBanner() {
  const el = document.getElementById('sync-banner');
  if (!el) return;

  const paint = (detail) => {
    const state = detail?.state || getBannerState().state;
    const message = detail?.message || '';
    el.dataset.state = state;
    const label = LABELS[state] || LABELS.online;
    el.innerHTML = `<span class="sync-banner-label">${label}</span>${
      message && state !== 'online' && state !== 'offline'
        ? `<span class="sync-banner-msg">${message}</span>`
        : state === 'offline'
          ? `<span class="sync-banner-msg">Changes stay on this phone until you are back online.</span>`
          : `<span class="sync-banner-msg">On-device · no cloud backend yet</span>`
    }`;
  };

  listenConnectivity();
  paint(getBannerState());

  window.addEventListener(SYNC_EVENT, (e) => paint(e.detail));
  window.addEventListener(STORAGE_ERROR_EVENT, (e) => {
    reportSyncState('error', e.detail?.message || 'Save failed. Data was not written.');
  });
}
