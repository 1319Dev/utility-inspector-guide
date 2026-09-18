/**
 * Active project context — persisted in settings (localStorage) and IndexedDB meta.
 */
import { loadSettings, saveSettings } from '../store.js';
import { getRecord, getMeta, setMeta } from './records.js';

const META_KEY = 'activeProject';

export function getActiveProjectId() {
  return loadSettings().activeProjectId || null;
}

export async function setActiveProjectId(projectId) {
  saveSettings({ activeProjectId: projectId || null });
  try {
    await setMeta(META_KEY, { projectId: projectId || null });
  } catch {
    /* settings already saved */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('uig:project-change', { detail: { projectId } }));
  }
  return projectId || null;
}

export async function getActiveProject() {
  const id = getActiveProjectId();
  if (!id) {
    const meta = await getMeta(META_KEY).catch(() => null);
    if (meta?.projectId) return getRecord('projects', meta.projectId);
    return null;
  }
  return getRecord('projects', id);
}

export function projectLabel(p) {
  if (!p) return 'No project selected';
  const bits = [p.name, p.projectNumber || p.woNumber].filter(Boolean);
  return bits.join(' · ') || 'Untitled project';
}
