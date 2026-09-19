/**
 * Materials Check-In helpers — qty math and line status.
 * Records live in IndexedDB via records.js (packingLists, materials, materialCheckins).
 */

export const CHECKIN_STATUSES = [
  { id: 'ok', label: 'OK' },
  { id: 'short', label: 'Short' },
  { id: 'damaged', label: 'Damaged' },
];

/** Parse a quantity cell. Empty / blank stays empty (null) — never invent a number. */
export function parseQty(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function receivedTotal(events) {
  return (events || []).reduce((sum, ev) => {
    const n = parseQty(ev?.receivedQty);
    return n == null ? sum : sum + n;
  }, 0);
}

export function remainingQty(expected, received) {
  if (expected == null) return null;
  return expected - (received || 0);
}

/**
 * Soft complete: received >= expected when expected is set.
 * `completeOverride` lets the inspector mark complete early or keep open.
 */
export function isLineComplete(line, received) {
  if (line?.completeOverride) return !!line.complete;
  const expected = parseQty(line?.expectedQty);
  if (expected != null && (received || 0) >= expected) return true;
  return !!line?.complete;
}

export function latestEvent(events) {
  if (!events?.length) return null;
  return [...events].sort((a, b) => String(b.when || b.createdAt || '').localeCompare(String(a.when || a.createdAt || '')))[0];
}

/** Roll-up status for list chips: damaged > short > complete/ok > pending. */
export function lineStatus(line, events) {
  const received = receivedTotal(events);
  const complete = isLineComplete(line, received);
  const hasDamaged = (events || []).some((ev) => ev.status === 'damaged');
  if (hasDamaged) return { id: 'damaged', label: 'Damaged' };
  const expected = parseQty(line?.expectedQty);
  if (complete) return { id: 'ok', label: 'Complete' };
  if ((events || []).some((ev) => ev.status === 'short') || (expected != null && received > 0 && received < expected)) {
    return { id: 'short', label: 'Short' };
  }
  if (received > 0) return { id: 'ok', label: 'Partial' };
  return { id: 'idle', label: 'Open' };
}

export function lineProgress(line, events) {
  const received = receivedTotal(events);
  const expected = parseQty(line?.expectedQty);
  return {
    received,
    expected,
    remaining: remainingQty(expected, received),
    complete: isLineComplete(line, received),
    status: lineStatus(line, events),
    last: latestEvent(events),
  };
}
