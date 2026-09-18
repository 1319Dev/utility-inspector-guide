/**
 * Home dashboard — current project, Start of Day, crew, alerts, quick links.
 */
import { loadSettings } from '../store.js';
import { listRecords } from '../data/records.js';
import { getActiveProject, projectLabel, setActiveProjectId } from '../data/context.js';
import { oqAlerts, certAlerts, displayOqStatus } from '../data/oq.js';
import { COMPLIANCE_NOTE } from '../data/constants.js';
import { esc, todayISO, statusPill } from './dom.js';
import { navigate } from './navigate.js';

function draftHints() {
  const items = [];
  try {
    const daily = JSON.parse(localStorage.getItem('uig:dailyReportDraft') || 'null');
    if (daily && (daily.comments || daily.projectNo || daily.date === todayISO())) {
      items.push({ nav: 'daily', title: 'Daily Report draft', meta: daily.date || 'open' });
    }
  } catch {
    /* ignore */
  }
  return items;
}

export async function mountHome(root) {
  const settings = loadSettings();
  const [projects, workers, oqs, crewDays, sods] = await Promise.all([
    listRecords('projects'),
    listRecords('workers'),
    listRecords('oqRecords'),
    listRecords('crewDays'),
    listRecords('startOfDayChecks'),
  ]);
  const project = await getActiveProject();
  const today = todayISO();
  const projectId = project?.id || null;

  const crewToday = crewDays.find((c) => c.date === today && (!projectId || c.projectId === projectId));
  const sodToday = sods.find((s) => s.date === today && (!projectId || s.projectId === projectId));

  const oqAlertList = oqAlerts(oqs).slice(0, 6);
  const certAlertList = certAlerts(workers).slice(0, 4);
  const drafts = draftHints();

  const crewN = crewToday?.crew?.length || 0;
  const crewIssues = crewToday
    ? (crewToday.crew || []).filter((m) => !m.ok).length
    : null;
  const crewOk = crewToday ? crewN - (crewIssues || 0) : null;

  const sodLabel = !sodToday
    ? 'Not started'
    : sodToday.result === 'ready'
      ? 'READY FOR WORK'
      : sodToday.override?.used
        ? 'ISSUES — override documented'
        : 'ISSUES REQUIRE DOCUMENTATION';
  const sodStatus = !sodToday ? 'idle' : sodToday.result === 'ready' ? 'ready' : 'warn';

  root.innerHTML = `
    <p class="disclaimer-banner" role="note">
      <span class="disclaimer-icon" aria-hidden="true">⚠</span>
      <span>Field reference only — not engineering advice. Follow your employer’s program and a competent person.</span>
    </p>
    <p class="compliance-note">${esc(COMPLIANCE_NOTE)}</p>

    <section class="dash-card dash-project">
      <div class="dash-card-head">
        <h2>Current project</h2>
        <button type="button" class="secondary-btn dash-mini" data-nav="projects">All</button>
      </div>
      <p class="dash-project-name">${esc(projectLabel(project))}</p>
      ${
        project
          ? `<p class="muted">${esc(project.operator || '')}${project.county || project.state ? ` · ${esc([project.county, project.state].filter(Boolean).join(', '))}` : ''}</p>`
          : '<p class="muted">Select a project to attach OQ, crew, and Start of Day records.</p>'
      }
      <div class="field">
        <label for="home-project">Active project</label>
        <select id="home-project">
          <option value="">— None —</option>
          ${projects
            .map(
              (p) =>
                `<option value="${esc(p.id)}"${p.id === projectId ? ' selected' : ''}>${esc(projectLabel(p))}</option>`
            )
            .join('')}
        </select>
      </div>
    </section>

    <div class="dash-grid">
      <button type="button" class="dash-stat" data-nav="start-of-day">
        <span class="dash-stat-kicker">Start of Day</span>
        ${statusPill(sodStatus, sodLabel)}
      </button>
      <button type="button" class="dash-stat" data-nav="crew">
        <span class="dash-stat-kicker">Today’s crew</span>
        ${
          crewToday
            ? `<span class="dash-stat-big">${crewN} workers</span>
               <span class="muted">${crewOk} compliant · ${crewIssues} issues</span>`
            : '<span class="muted">No crew verification yet</span>'
        }
      </button>
    </div>

    <section class="dash-card">
      <h2>Quick actions</h2>
      <div class="dash-actions">
        <button type="button" class="primary-btn" data-nav="start-of-day">Start of Day</button>
        <button type="button" class="secondary-btn" data-nav="oq">OQ Center</button>
        <button type="button" class="secondary-btn" data-nav="crew">Crew check</button>
        <button type="button" class="secondary-btn" data-nav="daily">Daily Report</button>
        <button type="button" class="secondary-btn" data-nav="weather">Weather</button>
      </div>
      ${settings.inspectorName ? `<p class="muted">Inspector: ${esc(settings.inspectorName)}</p>` : '<p class="muted">Set your name under More → Inspector name (or Emergency).</p>'}
    </section>

    <section class="dash-card">
      <div class="dash-card-head">
        <h2>Alerts</h2>
        <button type="button" class="secondary-btn dash-mini" data-nav="oq">OQ</button>
      </div>
      ${
        !oqAlertList.length && !certAlertList.length
          ? '<p class="muted">No expiring OQs or certifications in the next 90 days.</p>'
          : `<div class="list">
              ${oqAlertList
                .map((a) => {
                  const s = displayOqStatus(a.rec);
                  const label = s === 'expired' ? `Expired ${Math.abs(a.days)}d ago` : `Expires in ${a.days}d`;
                  return `<button type="button" class="list-item list-btn" data-open-oq="${esc(a.rec.id)}">
                    <strong>${esc(a.rec.workerName || 'Worker')} · ${esc(a.rec.taskNumber || a.rec.taskDesc || 'Task')}</strong>
                    <span class="meta">${statusPill(s, label)}</span>
                  </button>`;
                })
                .join('')}
              ${certAlertList
                .map(
                  (a) => `<button type="button" class="list-item list-btn" data-nav="personnel">
                    <strong>${esc(a.worker.name)} · ${esc(a.cert.name || a.cert.type)}</strong>
                    <span class="meta">${a.kind === 'expired' ? 'Cert expired' : `Cert in ${a.days}d`}</span>
                  </button>`
                )
                .join('')}
            </div>`
      }
    </section>

    <section class="dash-card">
      <h2>Open / draft items</h2>
      ${
        drafts.length
          ? `<div class="list">${drafts
              .map(
                (d) =>
                  `<button type="button" class="list-item list-btn" data-nav="${esc(d.nav)}"><strong>${esc(d.title)}</strong><span class="meta">${esc(d.meta)}</span></button>`
              )
              .join('')}</div>`
          : '<p class="muted">No daily draft flagged. Saved reports stay in Daily Report.</p>'
      }
    </section>
  `;

  root.querySelector('#home-project')?.addEventListener('change', async (e) => {
    await setActiveProjectId(e.target.value || null);
    mountHome(root);
  });

  root.querySelectorAll('[data-open-oq]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('oq-edit', { editId: btn.dataset.openOq }));
  });
}
