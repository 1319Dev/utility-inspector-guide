/**
 * Crossing Sketch exports: PDF (pdf-lib), PNG/JPG, JSON, CSV.
 * Report layout is a clean letter-size document — not a screenshot of the mobile UI.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { downloadBlob, downloadText, formatStamp } from '../../store.js';
import {
  fileSlug,
  formatMdY,
  isUnknownUtility,
  measureTypeLabel,
  pipelineCaption,
  serializeCrossing,
} from './model.js';
import { canvasToBlob, renderViewCanvas } from './draw.js';
import { crossingToCsv, crossingToJson } from './persist.js';

function pdfSafe(s) {
  return String(s ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function wrap(font, text, size, maxWidth) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function embedCanvas(pdf, canvas, type = 'png') {
  const mime = type === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await canvasToBlob(canvas, mime, 0.92);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return type === 'jpg' ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
}

function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

export async function buildCrossingPdf(record) {
  const r = serializeCrossing(record);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.1, 0.16);
  const muted = rgb(0.29, 0.33, 0.41);
  const rule = rgb(0.78, 0.82, 0.88);
  const accent = rgb(0.12, 0.23, 0.54);

  const planCanvas = renderViewCanvas(r, 'plan', 1600, 1100, true);
  const profileCanvas = renderViewCanvas(r, 'profile', 1600, 1100, true);
  const planImg = await embedCanvas(pdf, planCanvas);
  const profileImg = await embedCanvas(pdf, profileCanvas);

  const page1 = pdf.addPage([612, 792]);
  let y = 752;
  page1.drawText('PIPELINE CROSSING REPORT', { x: 40, y, size: 18, font: bold, color: accent });
  y -= 18;
  page1.drawText(pdfSafe(r.displayName || 'Crossing'), { x: 40, y, size: 11, font, color: ink });
  y -= 14;
  page1.drawText(`Crossing ID: ${r.id}    Exported: ${formatStamp()}`, {
    x: 40,
    y,
    size: 8,
    font,
    color: muted,
  });
  y -= 10;
  page1.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 1, color: rule });
  y -= 18;

  const meta = r.meta || {};
  const cols = [
    [`Project`, meta.project],
    [`Line / Pipeline`, meta.lineName],
    [`Station`, meta.station],
    [`Date`, formatMdY(meta.date) || meta.date],
    [`Inspector`, meta.inspector],
    [`Contractor`, meta.contractor],
    [`Foreman`, meta.foreman],
    [`Crossing type`, meta.crossingType],
  ];
  let colY = y;
  cols.forEach((pair, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 40 + col * 270;
    const yy = colY - row * 28;
    page1.drawText(pair[0].toUpperCase(), { x, y: yy, size: 7, font: bold, color: muted });
    page1.drawText(pdfSafe(pair[1] || '—'), { x, y: yy - 12, size: 10, font, color: ink });
  });
  y = colY - 4 * 28 - 6;
  if (meta.location) {
    page1.drawText('LOCATION / DESCRIPTION', { x: 40, y, size: 7, font: bold, color: muted });
    y -= 12;
    for (const line of wrap(font, meta.location, 10, 532).slice(0, 3)) {
      page1.drawText(line, { x: 40, y, size: 10, font, color: ink });
      y -= 12;
    }
  }

  y -= 8;
  page1.drawText('PLAN VIEW', { x: 40, y, size: 10, font: bold, color: accent });
  y -= 6;
  const planH = 210;
  page1.drawImage(planImg, { x: 40, y: y - planH, width: 532, height: planH });
  y -= planH + 16;
  page1.drawText('PROFILE VIEW', { x: 40, y, size: 10, font: bold, color: accent });
  y -= 6;
  const profH = 210;
  page1.drawImage(profileImg, { x: 40, y: y - profH, width: 532, height: profH });
  page1.drawText('Schematic sketches — not to scale. Entered measurements are authoritative.', {
    x: 40,
    y: 28,
    size: 7,
    font,
    color: muted,
  });

  let page2 = pdf.addPage([612, 792]);
  y = 752;
  const ensureRoom = (need = 56) => {
    if (y >= need) return;
    page2.drawText(`Crossing ID ${r.id}`, { x: 40, y: 28, size: 7, font, color: muted });
    page2 = pdf.addPage([612, 792]);
    y = 752;
  };
  const drawHeading = (title) => {
    ensureRoom(80);
    page2.drawText(title, { x: 40, y, size: 11, font: bold, color: accent });
    y -= 6;
    page2.drawLine({ start: { x: 40, y }, end: { x: 572, y }, thickness: 0.8, color: rule });
    y -= 14;
  };
  const kv = (label, value) => {
    const lines = wrap(font, value || '-', 10, 400);
    ensureRoom(56 + lines.length * 13);
    page2.drawText(pdfSafe(label), { x: 40, y, size: 8, font: bold, color: muted });
    page2.drawText(lines[0], { x: 168, y, size: 10, font, color: ink });
    y -= 14;
    for (const extra of lines.slice(1)) {
      ensureRoom(48);
      page2.drawText(extra, { x: 168, y, size: 10, font, color: ink });
      y -= 13;
    }
  };

  drawHeading('PIPELINE');
  const pipes = (r.objects || []).filter((o) => o.kind === 'pipeline');
  if (!pipes.length) kv('Pipeline', 'None drawn');
  pipes.forEach((p, i) => {
    const pr = p.props || {};
    kv(pipes.length > 1 ? `Pipeline ${i + 1}` : 'Name', pr.name || pipelineCaption(p));
    kv('Diameter', pr.diameter);
    kv('Material', pr.material);
    kv('Coating', pr.coating);
    kv('Station', pr.station);
    kv('Depth / cover', pr.depth);
    kv('Direction', pr.direction);
    kv('Notes', pr.notes);
    y -= 6;
  });

  drawHeading('CROSSING UTILITY');
  const utils = (r.objects || []).filter((o) => o.kind === 'utility' || o.kind === 'unknown');
  if (!utils.length) kv('Utility', 'None drawn');
  utils.forEach((u, i) => {
    const pr = u.props || {};
    const unknown = isUnknownUtility(u);
    kv(utils.length > 1 ? `Utility ${i + 1}` : 'Type', unknown ? 'UNKNOWN UTILITY' : pr.type || '—');
    kv('Diameter', pr.diameter);
    kv('Material', pr.material);
    kv('Owner / operator', unknown ? '—' : pr.owner);
    kv('Depth', pr.depth);
    kv('Direction', pr.direction);
    kv('Status', pr.status);
    kv('Notes', pr.notes);
    y -= 6;
  });

  drawHeading('MEASUREMENTS (as entered)');
  const meas = (r.objects || []).filter((o) => o.kind === 'measurement');
  if (!meas.length) kv('Measurements', 'None entered');
  meas.forEach((m) => {
    const pr = m.props || {};
    const label = pr.label ? `${measureTypeLabel(pr.measureType)} — ${pr.label}` : measureTypeLabel(pr.measureType);
    kv(label, pr.valueText || '(no value entered)');
  });

  y -= 4;
  drawHeading('LOCATION');
  const gps =
    meta.lat || meta.lon
      ? `${meta.lat || '—'}, ${meta.lon || '—'}${meta.gpsAccuracy ? ` (±${meta.gpsAccuracy})` : ''}`
      : 'Not entered';
  kv('Lat / Lon', gps);
  kv('Source', meta.gpsSource === 'auto' ? 'GPS' : 'Manual');

  y -= 4;
  drawHeading('NOTES');
  const notes = wrap(font, meta.notes || '-', 10, 532);
  for (const line of notes) {
    ensureRoom(48);
    page2.drawText(line, { x: 40, y, size: 10, font, color: ink });
    y -= 13;
  }
  page2.drawText(`Crossing ID ${r.id}`, { x: 40, y: 28, size: 7, font, color: muted });

  const photos = r.photos || [];
  if (photos.length) {
    let page = pdf.addPage([612, 792]);
    y = 752;
    page.drawText('PHOTOS', { x: 40, y, size: 11, font: bold, color: accent });
    y -= 18;
    for (const ph of photos) {
      const parsed = dataUrlToBytes(ph.dataUrl);
      if (!parsed) continue;
      let img;
      try {
        if (parsed.mime.includes('png')) img = await pdf.embedPng(parsed.bytes);
        else img = await pdf.embedJpg(parsed.bytes);
      } catch {
        continue;
      }
      const maxW = 532;
      const maxH = 280;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      if (y - h - 28 < 40) {
        page = pdf.addPage([612, 792]);
        y = 752;
      }
      const caption = ph.label === 'Custom' ? ph.customLabel || 'Custom' : ph.label || 'Photo';
      page.drawText(pdfSafe(caption), { x: 40, y, size: 9, font: bold, color: ink });
      y -= 8;
      page.drawImage(img, { x: 40, y: y - h, width: w, height: h });
      y -= h + 18;
    }
  }

  return pdf.save();
}

export async function exportPdf(record) {
  const bytes = await buildCrossingPdf(record);
  downloadBlob(`crossing-${fileSlug(record)}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
}

export async function exportPng(record, view = 'plan') {
  const canvas = renderViewCanvas(record, view, 1600, 1100, true);
  const blob = await canvasToBlob(canvas, 'image/png');
  downloadBlob(`crossing-${fileSlug(record)}-${view}.png`, blob);
}

export async function exportJpg(record, view = 'plan') {
  const canvas = renderViewCanvas(record, view, 1600, 1100, true);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  downloadBlob(`crossing-${fileSlug(record)}-${view}.jpg`, blob);
}

export function exportJson(record) {
  downloadText(`crossing-${fileSlug(record)}.json`, crossingToJson(record), 'application/json');
}

export function exportCsv(record) {
  downloadText(`crossing-${fileSlug(record)}.csv`, crossingToCsv(record), 'text/csv');
}

export async function compressPhoto(file, maxEdge = 960, quality = 0.62) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('compress'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality
    );
  });
}
