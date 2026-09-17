/**
 * Crossing Sketch persistence via store.js (localStorage, prefix uig:).
 * Index + per-record keys so one oversized photo set cannot wipe the library.
 * FUTURE: cloud sync — keep these function names as the local adapter.
 */

import { load, save, remove } from '../../store.js';
import { indexEntry, parseCrossing, serializeCrossing } from './model.js';

const INDEX_KEY = 'crossingIndex';
const DRAFT_KEY = 'crossingDraft';
const MAX_INDEX = 80;

export function listIndex() {
  const list = load(INDEX_KEY, []);
  return Array.isArray(list) ? list : [];
}

function writeIndex(list) {
  return save(INDEX_KEY, list.slice(0, MAX_INDEX));
}

export function loadCrossing(id) {
  if (!id) return null;
  return parseCrossing(load(`crossing:${id}`, null));
}

export function saveCrossing(record) {
  const serialized = serializeCrossing(record);
  const ok = save(`crossing:${serialized.id}`, serialized);
  if (!ok) return { ok: false, error: 'quota' };

  const entry = indexEntry(serialized);
  const list = listIndex().filter((e) => e.id !== serialized.id);
  list.unshift(entry);
  if (!writeIndex(list)) {
    return { ok: false, error: 'quota' };
  }
  return { ok: true, record: serialized };
}

export function deleteCrossing(id) {
  remove(`crossing:${id}`);
  writeIndex(listIndex().filter((e) => e.id !== id));
}

export function duplicateCrossing(id) {
  const src = loadCrossing(id);
  if (!src) return null;
  const copy = parseCrossing({
    ...src,
    id: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    displayName: src.displayName,
  });
  copy.meta = { ...copy.meta };
  const saved = saveCrossing(copy);
  return saved.ok ? saved.record : null;
}

export function saveDraft(record) {
  if (!record) {
    remove(DRAFT_KEY);
    return true;
  }
  return save(DRAFT_KEY, serializeCrossing(record));
}

export function loadDraft() {
  return parseCrossing(load(DRAFT_KEY, null));
}

export function clearDraft() {
  remove(DRAFT_KEY);
}

export function crossingToCsv(record) {
  const r = serializeCrossing(record);
  const types = (r.objects || [])
    .filter((o) => o.kind === 'utility' || o.kind === 'unknown')
    .map((o) => (o.kind === 'unknown' ? 'Unknown' : o.props?.type || 'Unknown'))
    .join('; ');
  const measures = (r.objects || [])
    .filter((o) => o.kind === 'measurement')
    .map((o) => {
      const t = o.props?.measureType || 'custom';
      const v = o.props?.valueText || '';
      return `${t}:${v}`;
    })
    .join('; ');
  const headers = [
    'id',
    'displayName',
    'project',
    'lineName',
    'station',
    'date',
    'inspector',
    'contractor',
    'foreman',
    'crossingType',
    'location',
    'lat',
    'lon',
    'utilityTypes',
    'measurements',
    'notes',
    'updatedAt',
  ];
  const row = [
    r.id,
    r.displayName,
    r.meta.project,
    r.meta.lineName,
    r.meta.station,
    r.meta.date,
    r.meta.inspector,
    r.meta.contractor,
    r.meta.foreman,
    r.meta.crossingType,
    r.meta.location,
    r.meta.lat,
    r.meta.lon,
    types,
    measures,
    r.meta.notes,
    r.updatedAt,
  ].map(csvCell);
  return `${headers.join(',')}\n${row.join(',')}\n`;
}

function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function crossingToJson(record) {
  return `${JSON.stringify(serializeCrossing(record), null, 2)}\n`;
}
