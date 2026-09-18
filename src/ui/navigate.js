/**
 * Hash + in-memory navigation. Avoids circular imports from tool modules.
 */
let showViewFn = null;

export function bindShowView(fn) {
  showViewFn = fn;
}

export function navigate(name, state = {}) {
  if (state.editId !== undefined) {
    try {
      sessionStorage.setItem(`uig:edit:${name}`, state.editId || '');
    } catch {
      /* private mode */
    }
  }
  if (showViewFn) showViewFn(name);
  else {
    const hash = name === 'home' ? '' : `#${name}`;
    location.hash = hash;
  }
}

export function takeEditId(name) {
  try {
    return sessionStorage.getItem(`uig:edit:${name}`) || '';
  } catch {
    return '';
  }
}

export const TAB_FOR_VIEW = {
  home: 'home',
  inspect: 'inspect',
  projects: 'projects',
  project: 'projects',
  reports: 'reports',
  more: 'more',
  personnel: 'more',
  worker: 'more',
  oq: 'more',
  'oq-edit': 'more',
  crew: 'reports',
  'start-of-day': 'reports',
  daily: 'reports',
  scope: 'reports',
  slope: 'inspect',
  photo: 'inspect',
  cover: 'inspect',
  locate: 'inspect',
  'trench-card': 'inspect',
  pressure: 'inspect',
  confined: 'inspect',
  station: 'inspect',
  weather: 'inspect',
  bellhole: 'inspect',
  emergency: 'more',
  lookups: 'more',
  mitti: 'more',
  materials: 'inspect',
};

export function highlightTab(name) {
  const tab = TAB_FOR_VIEW[name] || 'home';
  document.querySelectorAll('.bottom-nav [data-nav]').forEach((btn) => {
    const on = btn.dataset.nav === tab;
    btn.classList.toggle('is-active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
