/**
 * Mitti (SafetyCulture) — one-tap launcher to the official web/app URL.
 * No API tokens or SafetyCulture/Mitti API calls.
 */

const MITTI_URL = 'https://app.mitti.com/';

export function mountMitti(root) {
  root.innerHTML = `
    <p class="muted">
      Use <strong>Mitti</strong> (SafetyCulture) for company safety culture checklists, inspections, and observations.
      This app does not replace Mitti.
    </p>
    <div class="card mitti-card">
      <a
        class="primary-btn mitti-open-btn"
        href="${MITTI_URL}"
        target="_blank"
        rel="noopener noreferrer"
      >Open Mitti</a>
      <p class="muted mitti-note">
        Opens the official Mitti web app. On iPhone, Safari hands off to the Mitti / SafetyCulture app when it is installed.
        Inspections, issues, and observations live inside Mitti — navigate there after it opens.
      </p>
    </div>
  `;
}
