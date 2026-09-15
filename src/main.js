/**
 * Utility Inspector Guide — multi-tool field PWA
 */
import { enterSlope, leaveSlope, slopeHelp } from './tools/slope.js';
import { mountPhoto } from './tools/photoStamp.js';
import { mountVoice } from './tools/voiceNote.js';
import { mountCover } from './tools/depthCover.js';
import { mountSep } from './tools/separation.js';
import { mountLocate } from './tools/locate811.js';
import { mountTrenchCard } from './tools/trenchCard.js';
import { mountPressure } from './tools/pressureLog.js';
import { mountConfined } from './tools/confinedTimer.js';
import { mountEmergency } from './tools/emergency.js';
import { mountLookups } from './tools/lookups.js';

const VIEWS = [
  'home',
  'slope',
  'photo',
  'voice',
  'cover',
  'sep',
  'locate',
  'trench-card',
  'pressure',
  'confined',
  'emergency',
  'lookups',
];

const mounted = new Set();
let current = 'home';

function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';

  if (current === 'slope' && name !== 'slope') {
    leaveSlope();
  }

  document.querySelectorAll('.view').forEach((el) => {
    el.hidden = el.dataset.view !== name;
  });

  document.body.classList.remove('view-home', 'view-scroll', 'view-slope');
  if (name === 'home') document.body.classList.add('view-home', 'view-scroll');
  else if (name === 'slope') document.body.classList.add('view-slope');
  else document.body.classList.add('view-scroll');

  if (name === 'slope') enterSlope();
  else ensureMounted(name);

  current = name;
  const hash = name === 'home' ? '' : `#${name}`;
  if (location.hash.replace(/^#/, '') !== (hash ? name : '')) {
    history.replaceState(null, '', hash || location.pathname + location.search);
  }
  window.scrollTo(0, 0);
}

function ensureMounted(name) {
  if (mounted.has(name)) return;
  const map = {
    photo: ['photo-root', mountPhoto],
    voice: ['voice-root', mountVoice],
    cover: ['cover-root', mountCover],
    sep: ['sep-root', mountSep],
    locate: ['locate-root', mountLocate],
    'trench-card': ['trench-card-root', mountTrenchCard],
    pressure: ['pressure-root', mountPressure],
    confined: ['confined-root', mountConfined],
    emergency: ['emergency-root', mountEmergency],
    lookups: ['lookups-root', mountLookups],
  };
  const entry = map[name];
  if (!entry) return;
  const el = document.getElementById(entry[0]);
  if (!el) return;
  entry[1](el);
  mounted.add(name);
}

function routeFromHash() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  showView(raw || 'home');
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    showView(nav.dataset.nav);
    return;
  }
  const info = e.target.closest('[data-info]');
  if (info) {
    const dlg = document.getElementById('tool-info-dialog');
    const title = document.getElementById('tool-info-title');
    const body = document.getElementById('tool-info-body');
    if (info.dataset.info === 'slope') {
      title.textContent = 'Trench Slope';
      body.innerHTML = slopeHelp;
      dlg.showModal();
    }
  }
});

document.getElementById('btn-info')?.addEventListener('click', () => {
  document.getElementById('info-dialog').showModal();
});

window.addEventListener('hashchange', routeFromHash);
routeFromHash();
registerSW();
