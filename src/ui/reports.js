import { loadSettings, saveSettings } from '../store.js';
import { listRecords } from '../data/records.js';
import { getActiveProject, projectLabel } from '../data/context.js';
import { esc, complianceNote, todayISO, statusPill } from './dom.js';

export async function mountReports(root) {
  const project = await getActiveProject();
  const today = todayISO();
  const [crewDays, sods] = await Promise.all([
    listRecords('crewDays'),
    listRecords('startOfDayChecks'),
  ]);
  const crew = crewDays.find((c) => c.date === today && (!project?.id || c.projectId === project.id));
  const sod = sods.find((c) => c.date === today && (!project?.id || c.projectId === project.id));

  root.innerHTML = `
    ${complianceNote()}
    <p class="muted">${project ? esc(projectLabel(project)) : 'No active project'}</p>
    <div class="hub-grid reports-grid" role="navigation" aria-label="Reports">
      <button type="button" class="hub-tile" data-nav="daily" data-tone="orange">
        <span class="hub-icon" aria-hidden="true">📝</span>
        <span class="hub-copy">
          <span class="hub-title">Daily Report</span>
          <span class="hub-desc">Progress · footage · PDF</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="crew" data-tone="lime">
        <span class="hub-icon" aria-hidden="true">👷</span>
        <span class="hub-copy">
          <span class="hub-title">Crew verification</span>
          <span class="hub-desc">${crew ? `${crew.crew?.length || 0} on roster today` : 'Build today’s roster'}</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="start-of-day" data-tone="amber">
        <span class="hub-icon" aria-hidden="true">☀️</span>
        <span class="hub-copy">
          <span class="hub-title">Start of Day</span>
          <span class="hub-desc">${sod ? (sod.result === 'ready' ? 'READY FOR WORK' : 'Issues documented') : 'Checklist'}</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="scope" data-tone="slate">
        <span class="hub-icon" aria-hidden="true">📄</span>
        <span class="hub-copy">
          <span class="hub-title">Scope of Work</span>
          <span class="hub-desc">Preview · search · highlight</span>
        </span>
      </button>
    </div>
    <div class="card">
      <h3>Today</h3>
      <p>${crew ? statusPill(crew.allVerified ? 'qualified' : 'warn', crew.allVerified ? 'OQs verified' : 'Crew exceptions') : '<span class="muted">No crew day yet</span>'}</p>
      <p>${sod ? statusPill(sod.result === 'ready' ? 'ready' : 'warn', sod.result === 'ready' ? 'Start of Day ready' : 'Start of Day issues') : '<span class="muted">Start of Day not saved</span>'}</p>
    </div>
  `;
}

export async function mountMore(root) {
  const s = loadSettings();
  root.innerHTML = `
    ${complianceNote()}
    <div class="hub-grid" role="navigation" aria-label="More">
      <button type="button" class="hub-tile" data-nav="personnel" data-tone="cyan">
        <span class="hub-icon" aria-hidden="true">👤</span>
        <span class="hub-copy">
          <span class="hub-title">Personnel</span>
          <span class="hub-desc">Workers · certs · alerts</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="oq" data-tone="violet">
        <span class="hub-icon" aria-hidden="true">✅</span>
        <span class="hub-copy">
          <span class="hub-title">OQ Center</span>
          <span class="hub-desc">Manual verify · proof</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="emergency" data-tone="danger">
        <span class="hub-icon" aria-hidden="true">🚨</span>
        <span class="hub-copy">
          <span class="hub-title">Emergency</span>
          <span class="hub-desc">Contacts · nearest ER</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="lookups" data-tone="slate">
        <span class="hub-icon" aria-hidden="true">📘</span>
        <span class="hub-copy">
          <span class="hub-title">Lookups</span>
          <span class="hub-desc">Pipe size · material ID</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="mitti" data-tone="teal">
        <span class="hub-icon" aria-hidden="true">🛡️</span>
        <span class="hub-copy">
          <span class="hub-title">Mitti</span>
          <span class="hub-desc">Open safety culture app</span>
        </span>
      </button>
      <button type="button" class="hub-tile" data-nav="materials" data-tone="lime">
        <span class="hub-icon" aria-hidden="true">📦</span>
        <span class="hub-copy">
          <span class="hub-title">Materials Check-In</span>
          <span class="hub-desc">Packing list · receive · Excel</span>
        </span>
      </button>
    </div>
    <div class="card">
      <h3>Inspector name</h3>
      <p class="muted">Prefills OQ, crew, Start of Day, and Daily Report.</p>
      <div class="field"><label>Name</label>
        <input id="more-insp" value="${esc(s.inspectorName || '')}" autocomplete="name" />
      </div>
      <button type="button" class="primary-btn" id="more-insp-save">Save name</button>
      <p class="muted" id="more-insp-status"></p>
    </div>
    <p class="muted">Trench slope, bell hole, cover, station, photo, pressure, materials check-in, locate, trench card, confined timer, and weather live under Inspect.</p>
  `;

  root.querySelector('#more-insp-save')?.addEventListener('click', () => {
    saveSettings({ inspectorName: root.querySelector('#more-insp').value.trim() });
    root.querySelector('#more-insp-status').textContent = 'Saved.';
  });
}
