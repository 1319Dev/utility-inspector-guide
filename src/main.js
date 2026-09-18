/**
 * Utility Inspector Guide — multi-tool field PWA
 */
import { enterSlope, leaveSlope, slopeHelp } from './tools/slope.js';
import { mountPhoto } from './tools/photoStamp.js';
import { mountCover } from './tools/depthCover.js';
import { mountLocate } from './tools/locate811.js';
import { mountTrenchCard } from './tools/trenchCard.js';
import { mountPressure } from './tools/pressureLog.js';
import { mountConfined } from './tools/confinedTimer.js';
import { mountEmergency } from './tools/emergency.js';
import { mountLookups } from './tools/lookups.js';
import { mountScope } from './tools/scopeSearch.js';
import { mountDaily } from './tools/dailyReport.js';
import { mountStation, leaveStation } from './tools/stationLocator.js';
import { mountWeather, leaveWeather, enterWeather } from './tools/weatherRadar.js';
import { mountBellHole, leaveBellHole } from './tools/bellHole.js';
import { mountMitti } from './tools/mitti.js';
import { mountProjects, mountProjectEdit } from './tools/projects.js';
import { mountPersonnel, mountWorkerEdit } from './tools/personnel.js';
import { mountOqCenter, mountOqEdit } from './tools/oqCenter.js';
import { mountCrewDay } from './tools/crewDay.js';
import { mountStartOfDay } from './tools/startOfDay.js';
import { mountHome } from './ui/home.js';
import { mountReports, mountMore } from './ui/reports.js';
import { mountSyncBanner } from './ui/syncBanner.js';
import { bindShowView, highlightTab } from './ui/navigate.js';
import { ensureDb, flushPendingQueue, listPendingQueue } from './data/index.js';

const VIEWS = [
  'home',
  'inspect',
  'projects',
  'project',
  'reports',
  'more',
  'personnel',
  'worker',
  'oq',
  'oq-edit',
  'crew',
  'start-of-day',
  'slope',
  'photo',
  'cover',
  'locate',
  'trench-card',
  'pressure',
  'confined',
  'emergency',
  'lookups',
  'scope',
  'daily',
  'station',
  'weather',
  'bellhole',
  'mitti',
];

const REMOUNT = new Set([
  'home',
  'projects',
  'project',
  'reports',
  'more',
  'personnel',
  'worker',
  'oq',
  'oq-edit',
  'crew',
  'start-of-day',
]);

const mounted = new Set();
let current = 'home';

function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';

  if (current === 'slope' && name !== 'slope') {
    leaveSlope();
  }
  if (current === 'station' && name !== 'station') {
    leaveStation();
  }
  if (current === 'weather' && name !== 'weather') {
    leaveWeather();
  }
  if (current === 'bellhole' && name !== 'bellhole') {
    leaveBellHole();
  }

  document.querySelectorAll('.view').forEach((el) => {
    el.hidden = el.dataset.view !== name;
  });

  document.body.classList.remove('view-home', 'view-scroll', 'view-slope');
  if (name === 'home') document.body.classList.add('view-home', 'view-scroll');
  else if (name === 'slope') document.body.classList.add('view-slope');
  else document.body.classList.add('view-scroll');

  if (name === 'slope') enterSlope();
  else {
    const done = ensureMounted(name);
    Promise.resolve(done).then(() => {
      if (name === 'weather') enterWeather();
    });
  }

  current = name;
  highlightTab(name);
  const hash = name === 'home' ? '' : `#${name}`;
  if (location.hash.replace(/^#/, '') !== (hash ? name : '')) {
    history.replaceState(null, '', hash || location.pathname + location.search);
  }
  window.scrollTo(0, 0);
}

function ensureMounted(name) {
  const map = {
    home: ['home-root', mountHome],
    projects: ['projects-root', mountProjects],
    project: ['project-root', mountProjectEdit],
    reports: ['reports-root', mountReports],
    more: ['more-root', mountMore],
    personnel: ['personnel-root', mountPersonnel],
    worker: ['worker-root', mountWorkerEdit],
    oq: ['oq-root', mountOqCenter],
    'oq-edit': ['oq-edit-root', mountOqEdit],
    crew: ['crew-root', mountCrewDay],
    'start-of-day': ['sod-root', mountStartOfDay],
    photo: ['photo-root', mountPhoto],
    cover: ['cover-root', mountCover],
    locate: ['locate-root', mountLocate],
    'trench-card': ['trench-card-root', mountTrenchCard],
    pressure: ['pressure-root', mountPressure],
    confined: ['confined-root', mountConfined],
    emergency: ['emergency-root', mountEmergency],
    lookups: ['lookups-root', mountLookups],
    scope: ['scope-root', mountScope],
    daily: ['daily-root', mountDaily],
    station: ['station-root', mountStation],
    weather: ['weather-root', mountWeather],
    bellhole: ['bellhole-root', mountBellHole],
    mitti: ['mitti-root', mountMitti],
  };
  const entry = map[name];
  if (!entry) return;
  const el = document.getElementById(entry[0]);
  if (!el) return;
  if (!REMOUNT.has(name) && mounted.has(name)) return;
  mounted.add(name);
  try {
    const result = entry[1](el);
    return Promise.resolve(result).catch((err) => {
      console.error(err);
      el.innerHTML = `<p class="error">Could not open this screen. ${String(err?.message || err)}</p>`;
    });
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="error">Could not open this screen. ${String(err?.message || err)}</p>`;
  }
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

bindShowView(showView);
mountSyncBanner();
ensureDb()
  .then(() => flushPendingQueue(listPendingQueue))
  .catch(() => {});

window.addEventListener('hashchange', routeFromHash);
routeFromHash();
registerSW();
