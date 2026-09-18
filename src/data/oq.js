/** OQ status helpers, expiration windows, crew compliance. */
import { OQ_STATUSES, EXPIRATION_WINDOWS } from './constants.js';

export function daysUntil(iso) {
  if (!iso) return null;
  const raw = String(iso);
  const day = raw.length <= 10 ? `${raw}T23:59:59` : raw;
  const end = new Date(day);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

export function expirationBucket(iso) {
  const d = daysUntil(iso);
  if (d == null) return null;
  if (d < 0) return 'expired';
  for (const w of EXPIRATION_WINDOWS) {
    if (d <= w) return `d${w}`;
  }
  return 'ok';
}

export function statusMeta(id) {
  return OQ_STATUSES.find((s) => s.id === id) || OQ_STATUSES[4];
}

/** Display status: dates can upgrade Qualified → Expiring soon / Expired. */
export function displayOqStatus(rec) {
  if (!rec) return 'unable_to_verify';
  const recorded = rec.status || 'unable_to_verify';
  if (recorded === 'not_qualified' || recorded === 'unable_to_verify') return recorded;
  const d = daysUntil(rec.expirationDate);
  if (d != null && d < 0) return 'expired';
  if (recorded === 'expired') return 'expired';
  if ((d != null && d <= 90) || recorded === 'expiring_soon') return 'expiring_soon';
  if (recorded === 'qualified') return 'qualified';
  return recorded;
}

export function statusColor(status) {
  const s = statusMeta(status);
  return s.color;
}

export function isIssueStatus(status) {
  return status !== 'qualified';
}

export function oqAlerts(records, windows = EXPIRATION_WINDOWS) {
  const list = [];
  for (const rec of records || []) {
    const d = daysUntil(rec.expirationDate);
    if (d == null) continue;
    const disp = displayOqStatus(rec);
    if (disp === 'expired' || (d < 0)) {
      list.push({ rec, days: d, window: 'expired', kind: 'expired' });
      continue;
    }
    for (const w of windows) {
      if (d <= w) {
        list.push({ rec, days: d, window: w, kind: 'expiring' });
        break;
      }
    }
  }
  return list.sort((a, b) => a.days - b.days);
}

export function workerOqs(allOqs, workerId) {
  return (allOqs || []).filter((r) => r.workerId === workerId);
}

export function evaluateRequired(workerOqsList, requiredTaskIds) {
  const required = requiredTaskIds || [];
  if (!required.length) {
    const statuses = (workerOqsList || []).map(displayOqStatus);
    if (!statuses.length) {
      return { ok: false, missing: ['No OQ on file'], expiring: [], statuses };
    }
    const expiring = (workerOqsList || []).filter((r) => displayOqStatus(r) === 'expiring_soon');
    const bad = (workerOqsList || []).filter((r) => {
      const s = displayOqStatus(r);
      return s === 'expired' || s === 'not_qualified' || s === 'unable_to_verify';
    });
    return {
      ok: !bad.length,
      missing: bad.map((r) => r.taskNumber || r.taskDesc || 'OQ'),
      expiring: expiring.map((r) => r.taskNumber || r.taskDesc || 'OQ'),
      statuses,
    };
  }
  const missing = [];
  const expiring = [];
  for (const task of required) {
    const rec = (workerOqsList || []).find(
      (r) => r.id === task || r.taskNumber === task || `${r.taskNumber} ${r.taskDesc}`.trim() === task
    );
    if (!rec) {
      missing.push(task);
      continue;
    }
    const s = displayOqStatus(rec);
    if (s === 'qualified') continue;
    if (s === 'expiring_soon') expiring.push(rec.taskNumber || rec.taskDesc || task);
    else missing.push(rec.taskNumber || rec.taskDesc || task);
  }
  return { ok: !missing.length, missing, expiring, statuses: (workerOqsList || []).map(displayOqStatus) };
}

export function certAlerts(workers) {
  const list = [];
  for (const w of workers || []) {
    for (const c of w.certifications || []) {
      const d = daysUntil(c.expires);
      if (d == null) continue;
      if (d < 0) list.push({ worker: w, cert: c, days: d, kind: 'expired' });
      else if (d <= 90) list.push({ worker: w, cert: c, days: d, kind: 'expiring' });
    }
  }
  return list.sort((a, b) => a.days - b.days);
}
