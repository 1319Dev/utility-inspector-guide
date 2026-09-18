/**
 * Packing-list import + default Materials Check-In .xlsx export.
 * Company-template fill is deferred (see exportCompanyMaterialsXlsx).
 */
import { downloadBlob } from '../store.js';
import { parseQty, lineProgress, CHECKIN_STATUSES } from '../data/materials.js';

export const MATERIAL_FIELDS = [
  {
    key: 'description',
    label: 'Item / Description',
    aliases: [
      'item',
      'item no',
      'item number',
      'item #',
      'description',
      'desc',
      'material',
      'material description',
      'item description',
      'name',
      'product',
      'part',
      'part number',
      'part #',
      'part no',
    ],
  },
  {
    key: 'expectedQty',
    label: 'Expected qty',
    aliases: [
      'qty',
      'quantity',
      'ordered',
      'order qty',
      'qty ordered',
      'ordered qty',
      'expected',
      'expected qty',
      'ord qty',
      'qty ord',
    ],
  },
  {
    key: 'unit',
    label: 'Unit',
    aliases: ['unit', 'uom', 'u/m', 'units', 'um'],
  },
  {
    key: 'heatNumber',
    label: 'Heat #',
    aliases: ['heat', 'heat #', 'heat no', 'heat number', 'heat no.', 'ht', 'heat#'],
  },
  {
    key: 'poNumber',
    label: 'PO #',
    aliases: ['po', 'po #', 'po no', 'purchase order', 'po number', 'po#', 'p.o.'],
  },
  {
    key: 'size',
    label: 'Size / diameter',
    aliases: ['size', 'diameter', 'dia', 'nps', 'od', 'pipe size'],
  },
  {
    key: 'notes',
    label: 'Notes',
    aliases: ['notes', 'note', 'remarks', 'comment', 'comments', 'remark'],
  },
];

export function normalizeHeader(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[#._/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreHeader(header, aliases) {
  const n = normalizeHeader(header);
  if (!n) return 0;
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    if (n === a) return 4;
    if (n.startsWith(a) || a.startsWith(n)) return 3;
    if (n.includes(a) || a.includes(n)) return 2;
  }
  return 0;
}

export function autoMapHeaders(headers) {
  const map = {};
  const used = new Set();
  for (const field of MATERIAL_FIELDS) {
    let best = { idx: -1, score: 0 };
    headers.forEach((header, idx) => {
      if (used.has(idx)) return;
      const score = scoreHeader(header, field.aliases);
      if (score > best.score) best = { idx, score };
    });
    if (best.score >= 2) {
      map[field.key] = best.idx;
      used.add(best.idx);
    } else {
      map[field.key] = -1;
    }
  }
  return map;
}

export function mappingIsAmbiguous(headers, map) {
  if (!headers.length) return true;
  if ((map.description ?? -1) < 0) return true;
  const idxs = Object.values(map).filter((i) => i >= 0);
  if (new Set(idxs).size !== idxs.length) return true;
  const named = headers.filter((h) => normalizeHeader(h)).length;
  if (named >= 3 && idxs.length < 2) return true;
  return false;
}

export function looksLikeHeaderRow(row) {
  const texts = (row || []).map((c) => String(c ?? '').trim());
  if (!texts.some(Boolean)) return false;
  const map = autoMapHeaders(texts);
  return (map.description ?? -1) >= 0 || Object.values(map).filter((i) => i >= 0).length >= 2;
}

function cellText(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function rowsFromMapping(dataRows, map) {
  const lines = [];
  let skipped = 0;
  for (const row of dataRows) {
    if (!row || !row.some((c) => cellText(c))) {
      skipped += 1;
      continue;
    }
    const description = map.description >= 0 ? cellText(row[map.description]) : '';
    if (!description) {
      skipped += 1;
      continue;
    }
    const qtyRaw = map.expectedQty >= 0 ? row[map.expectedQty] : '';
    lines.push({
      description,
      expectedQty: parseQty(qtyRaw),
      unit: map.unit >= 0 ? cellText(row[map.unit]) : '',
      heatNumber: map.heatNumber >= 0 ? cellText(row[map.heatNumber]) : '',
      poNumber: map.poNumber >= 0 ? cellText(row[map.poNumber]) : '',
      size: map.size >= 0 ? cellText(row[map.size]) : '',
      notes: map.notes >= 0 ? cellText(row[map.notes]) : '',
    });
  }
  return { lines, skipped };
}

let xlsxMod = null;

async function loadXlsx() {
  if (!xlsxMod) xlsxMod = await import('xlsx');
  return xlsxMod;
}

export async function parsePackingFile(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
  const preferred =
    wb.SheetNames.find((n) => /pack|material|bom|list/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[preferred];
  if (!sheet) throw new Error('That file has no worksheet.');
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const trimmed = aoa.filter((row) => Array.isArray(row) && row.some((c) => cellText(c)));
  if (!trimmed.length) throw new Error('No rows found in that packing list.');
  const headerRow = looksLikeHeaderRow(trimmed[0]) ? trimmed[0].map((c) => cellText(c)) : null;
  const headers = headerRow || trimmed[0].map((_, i) => `Column ${i + 1}`);
  const dataRows = headerRow ? trimmed.slice(1) : trimmed;
  const map = autoMapHeaders(headerRow || headers);
  return {
    filename: file.name || 'packing-list',
    sheetName: preferred,
    headers,
    hasHeaderRow: !!headerRow,
    dataRows,
    map,
    ambiguous: mappingIsAmbiguous(headers, map) || !headerRow,
    preview: dataRows.slice(0, 4),
  };
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function statusLabel(id) {
  return CHECKIN_STATUSES.find((s) => s.id === id)?.label || id || '';
}

/**
 * V1 default field layout — two sheets.
 * Company-template fill (like Daily Report PDF fill) is deferred until a template is provided.
 */
export async function exportDefaultMaterialsXlsx({
  projectLabel,
  packingLists,
  lines,
  eventsByLine,
}) {
  const XLSX = await loadXlsx();
  const listName = (id) => packingLists.find((p) => p.id === id)?.name || packingLists.find((p) => p.id === id)?.filename || '';

  const summaryHeader = [
    'Project',
    'Packing list',
    'Item/Description',
    'Expected qty',
    'Unit',
    'Heat #',
    'PO #',
    'Size',
    'Received qty (total)',
    'Status',
    'Last check-in time',
    'Location',
    'Notes',
    'Line notes',
  ];
  const summaryRows = [summaryHeader];
  for (const line of lines) {
    const evs = eventsByLine.get(line.id) || [];
    const prog = lineProgress(line, evs);
    summaryRows.push([
      projectLabel || '',
      listName(line.packingListId),
      line.description || '',
      prog.expected ?? '',
      line.unit || '',
      line.heatNumber || '',
      line.poNumber || '',
      line.size || '',
      prog.received || 0,
      prog.status.label,
      fmtWhen(prog.last?.when),
      prog.last?.location || '',
      prog.last?.notes || '',
      line.notes || '',
    ]);
  }

  const eventHeader = [
    'Project',
    'Packing list',
    'Item/Description',
    'Received qty',
    'When',
    'Location',
    'Latitude',
    'Longitude',
    'Status',
    'Notes',
    'By',
  ];
  const eventRows = [eventHeader];
  for (const line of lines) {
    const evs = [...(eventsByLine.get(line.id) || [])].sort((a, b) =>
      String(a.when || '').localeCompare(String(b.when || ''))
    );
    for (const ev of evs) {
      eventRows.push([
        projectLabel || '',
        listName(line.packingListId),
        line.description || '',
        parseQty(ev.receivedQty) ?? '',
        fmtWhen(ev.when),
        ev.location || '',
        ev.lat ?? '',
        ev.lon ?? '',
        statusLabel(ev.status),
        ev.notes || '',
        ev.createdBy || '',
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  const ws2 = XLSX.utils.aoa_to_sheet(eventRows);
  ws1['!cols'] = summaryHeader.map(() => ({ wch: 18 }));
  ws2['!cols'] = eventHeader.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Materials Check-In');
  XLSX.utils.book_append_sheet(wb, ws2, 'Check-in events');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(`materials-check-in-${stamp}.xlsx`, blob);
  return blob;
}

/**
 * FUTURE extension point: company-template Excel fill.
 * Same idea as Daily Report PDF AcroForm fill (`fillCompanyPdf` in dailyReport.js).
 * Do not invent a layout here — wait for the user-supplied .xlsx template, then
 * map packing-list / check-in fields into named cells or a locked header row.
 * Until then, callers should use exportDefaultMaterialsXlsx().
 */
export async function exportCompanyMaterialsXlsx(_ctx) {
  throw new Error('Company materials Excel template not provided yet.');
}
