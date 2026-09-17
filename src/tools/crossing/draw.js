/**
 * Crossing Sketch — canvas 2D draw + hit-test + handle drag.
 * Schematic only: pixel spacing is NOT a real-world scale.
 */

import {
  getGeom,
  setGeom,
  geomBounds,
  unionBounds,
  isUnknownUtility,
  pipelineCaption,
  utilityCaption,
  measureTypeLabel,
} from './model.js';

const UTILITY_COLOR = {
  Gas: '#facc15',
  Water: '#38bdf8',
  Sewer: '#4ade80',
  'Storm Drain': '#2dd4bf',
  Electric: '#f87171',
  Fiber: '#fb923c',
  Communication: '#fb923c',
  Oil: '#fbbf24',
  Pipeline: '#7dd3fc',
  Drain: '#34d399',
  Unknown: '#94a3b8',
  Other: '#c4b5fd',
};

export function palette(print) {
  if (print) {
    return {
      bg: '#ffffff',
      grid: '#e2e8f0',
      axis: '#94a3b8',
      text: '#0f172a',
      muted: '#475569',
      select: '#0284c7',
      handle: '#0369a1',
      handleFill: '#e0f2fe',
      ground: '#57534e',
      excavation: '#78716c',
      road: '#44403c',
      fence: '#292524',
      north: '#0f172a',
      measure: '#0f172a',
      pipeline: '#1e3a8a',
      labelBg: 'rgba(255,255,255,0.92)',
      unknown: '#334155',
    };
  }
  return {
    bg: '#0a101c',
    grid: '#1e293b',
    axis: '#334155',
    text: '#f1f5f9',
    muted: '#94a3b8',
    select: '#38bdf8',
    handle: '#fde047',
    handleFill: '#0f172a',
    ground: '#d6d3d1',
    excavation: '#a8a29e',
    road: '#94a3b8',
    fence: '#cbd5e1',
    north: '#fde047',
    measure: '#f8fafc',
    pipeline: '#7dd3fc',
    labelBg: 'rgba(10,16,28,0.88)',
    unknown: '#cbd5e1',
  };
}

export function utilityColor(obj, print) {
  if (isUnknownUtility(obj)) return print ? '#334155' : '#94a3b8';
  const t = obj.props?.type || 'Other';
  const c = UTILITY_COLOR[t] || UTILITY_COLOR.Other;
  if (print && t === 'Gas') return '#a16207';
  if (print && t === 'Electric') return '#b91c1c';
  return c;
}

export function screenToWorld(sx, sy, camera) {
  return { x: camera.x + sx / camera.scale, y: camera.y + sy / camera.scale };
}

export function worldToScreen(wx, wy, camera) {
  return { x: (wx - camera.x) * camera.scale, y: (wy - camera.y) * camera.scale };
}

export function applyCamera(ctx, camera) {
  ctx.transform(
    camera.scale,
    0,
    0,
    camera.scale,
    -camera.x * camera.scale,
    -camera.y * camera.scale
  );
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

function normalOfLine(g) {
  const dx = g.x2 - g.x1;
  const dy = g.y2 - g.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len, ux: dx / len, uy: dy / len, len };
}

function snapAnglePoint(x1, y1, x2, y2, thresholdDeg = 8) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return { x: x2, y: y2 };
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snapped = Math.round(deg / 15) * 15;
  let delta = Math.abs(deg - snapped);
  delta = Math.min(delta, 360 - delta);
  if (delta > thresholdDeg) return { x: x2, y: y2 };
  const r = (snapped * Math.PI) / 180;
  return { x: x1 + Math.cos(r) * len, y: y1 + Math.sin(r) * len };
}

export function collectSnapTargets(record, view, excludeId) {
  const pts = [];
  for (const obj of record.objects || []) {
    if (obj.id === excludeId) continue;
    const g = getGeom(obj, view);
    if (!g) continue;
    if (g.type === 'line') {
      pts.push({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
    } else if (g.type === 'point') {
      pts.push({ x: g.x, y: g.y });
    } else if (g.type === 'rect') {
      pts.push({ x: g.x, y: g.y });
    } else if (g.type === 'poly') {
      for (const p of g.points) pts.push(p);
    }
  }
  return pts;
}

function snapToTargets(x, y, targets, thresh) {
  let best = null;
  let bestD = thresh;
  for (const t of targets) {
    const d = dist(x, y, t.x, t.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ? { x: best.x, y: best.y } : { x, y };
}

export function fitCamera(record, view, w, h, pad = 36) {
  const boxes = [];
  for (const obj of record.objects || []) {
    boxes.push(geomBounds(getGeom(obj, view)));
  }
  const box = unionBounds(boxes);
  if (!box) return { x: 0, y: 0, scale: 1 };
  const bw = Math.max(80, box.maxX - box.minX);
  const bh = Math.max(80, box.maxY - box.minY);
  const scale = Math.max(0.25, Math.min(3, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    x: cx - w / 2 / scale,
    y: cy - h / 2 / scale,
    scale,
  };
}

function drawGrid(ctx, camera, w, h, pal) {
  const step = 20;
  const topLeft = screenToWorld(0, 0, camera);
  const botRight = screenToWorld(w, h, camera);
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1 / camera.scale;
  ctx.beginPath();
  const x0 = Math.floor(topLeft.x / step) * step;
  const y0 = Math.floor(topLeft.y / step) * step;
  for (let x = x0; x <= botRight.x; x += step) {
    ctx.moveTo(x, topLeft.y);
    ctx.lineTo(x, botRight.y);
  }
  for (let y = y0; y <= botRight.y; y += step) {
    ctx.moveTo(topLeft.x, y);
    ctx.lineTo(botRight.x, y);
  }
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawLabelBubble(ctx, x, y, text, pal, camera, align = 'left') {
  if (!text) return;
  const size = Math.max(11, 12 / Math.sqrt(camera.scale));
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const pad = 5;
  const tw = ctx.measureText(text).width;
  let bx = x;
  if (align === 'center') bx = x - tw / 2 - pad;
  if (align === 'right') bx = x - tw - pad * 2;
  const by = y - size / 2 - 4;
  ctx.fillStyle = pal.labelBg;
  roundRect(ctx, bx, by, tw + pad * 2, size + 8, 4);
  ctx.fill();
  ctx.fillStyle = pal.text;
  ctx.textAlign = 'left';
  ctx.fillText(text, bx + pad, y);
}

function drawLine(ctx, g, color, width, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.lineTo(g.x2, g.y2);
  ctx.stroke();
  ctx.restore();
}

function drawPipeBody(ctx, g, color, thick) {
  const { nx, ny } = normalOfLine(g);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = thick;
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.lineTo(g.x2, g.y2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.lineTo(g.x2, g.y2);
  ctx.stroke();
  const o = thick / 2;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(g.x1 + nx * o, g.y1 + ny * o);
  ctx.lineTo(g.x2 + nx * o, g.y2 + ny * o);
  ctx.moveTo(g.x1 - nx * o, g.y1 - ny * o);
  ctx.lineTo(g.x2 - nx * o, g.y2 - ny * o);
  ctx.stroke();
  ctx.restore();
}

function arrowHead(ctx, x, y, ang, size, pal) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.42);
  ctx.lineTo(-size, -size * 0.42);
  ctx.closePath();
  ctx.fillStyle = pal.measure;
  ctx.fill();
  ctx.restore();
}

function drawDimension(ctx, g, obj, pal, camera) {
  const { ux, uy, nx, ny, len } = normalOfLine(g);
  ctx.save();
  ctx.strokeStyle = pal.measure;
  ctx.fillStyle = pal.measure;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.lineTo(g.x2, g.y2);
  ctx.stroke();
  const t = 8;
  ctx.beginPath();
  ctx.moveTo(g.x1 + nx * t, g.y1 + ny * t);
  ctx.lineTo(g.x1 - nx * t, g.y1 - ny * t);
  ctx.moveTo(g.x2 + nx * t, g.y2 + ny * t);
  ctx.lineTo(g.x2 - nx * t, g.y2 - ny * t);
  ctx.stroke();
  const headAngA = Math.atan2(-uy, -ux);
  const headAngB = Math.atan2(uy, ux);
  arrowHead(ctx, g.x1, g.y1, headAngA, 10, pal);
  arrowHead(ctx, g.x2, g.y2, headAngB, 10, pal);

  const entered = String(obj.props?.valueText || '').trim();
  const kind = measureTypeLabel(obj.props?.measureType);
  const text = entered || '(enter value)';
  const mx = (g.x1 + g.x2) / 2 + nx * 16;
  const my = (g.y1 + g.y2) / 2 + ny * 16;
  drawLabelBubble(ctx, mx, my, `${kind}: ${text}`, pal, camera, 'center');
  ctx.restore();
  void len;
}

function drawNorth(ctx, g, pal) {
  const r = 22;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.rotation || 0);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = pal.north;
  ctx.lineWidth = 2;
  ctx.fillStyle = pal.labelBg;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r + 3);
  ctx.lineTo(7, 6);
  ctx.lineTo(-7, 6);
  ctx.closePath();
  ctx.fillStyle = pal.north;
  ctx.fill();
  ctx.fillStyle = pal.bg;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, 10);
  ctx.restore();
}

function drawGround(ctx, g, pal) {
  if (!g?.points?.length) return;
  ctx.save();
  ctx.strokeStyle = pal.ground;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(g.points[0].x, g.points[0].y);
  for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i].x, g.points[i].y);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = 0; i < g.points.length - 1; i++) {
    const a = g.points[i];
    const b = g.points[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 8;
    const ny = (dx / len) * 8;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + nx, my + ny);
    ctx.stroke();
  }
  ctx.restore();
}

function drawExcavation(ctx, g, obj, pal) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.rotation || 0);
  ctx.fillStyle = 'rgba(148,163,184,0.16)';
  ctx.strokeStyle = pal.excavation;
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = pal.text;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tag = obj.props?.type === 'bellhole' ? 'BELL HOLE' : 'POTHOLE';
  ctx.fillText(tag, 0, 0);
  ctx.restore();
}

function drawRoad(ctx, g, pal) {
  const { nx, ny } = normalOfLine(g);
  const o = 10;
  ctx.save();
  ctx.strokeStyle = pal.road;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.x1 + nx * o, g.y1 + ny * o);
  ctx.lineTo(g.x2 + nx * o, g.y2 + ny * o);
  ctx.moveTo(g.x1 - nx * o, g.y1 - ny * o);
  ctx.lineTo(g.x2 - nx * o, g.y2 - ny * o);
  ctx.stroke();
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.lineTo(g.x2, g.y2);
  ctx.stroke();
  ctx.restore();
}

function drawFence(ctx, g, pal) {
  drawLine(ctx, g, pal.fence, 1.6);
  const { ux, uy } = normalOfLine(g);
  const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
  const step = 14;
  ctx.save();
  ctx.strokeStyle = pal.fence;
  ctx.lineWidth = 1.4;
  for (let d = 0; d <= len; d += step) {
    const x = g.x1 + ux * d;
    const y = g.y1 + uy * d;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDitch(ctx, g, pal) {
  const { nx, ny } = normalOfLine(g);
  ctx.save();
  ctx.strokeStyle = pal.ground;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.8;
  const o = 6;
  ctx.beginPath();
  ctx.moveTo(g.x1 + nx * o, g.y1 + ny * o);
  ctx.lineTo(g.x2 + nx * o, g.y2 + ny * o);
  ctx.moveTo(g.x1 - nx * o, g.y1 - ny * o);
  ctx.lineTo(g.x2 - nx * o, g.y2 - ny * o);
  ctx.stroke();
  ctx.restore();
}

function drawValve(ctx, g, pal) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.strokeStyle = pal.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-7, -7);
  ctx.lineTo(7, 7);
  ctx.moveTo(7, -7);
  ctx.lineTo(-7, 7);
  ctx.stroke();
  ctx.restore();
}

function drawTestStation(ctx, g, pal) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.fillStyle = pal.north;
  ctx.strokeStyle = pal.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(11, 8);
  ctx.lineTo(-11, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = pal.bg;
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TS', 0, 2);
  ctx.restore();
}

function captionOffset(g) {
  if (g.type === 'line') {
    const { nx, ny } = normalOfLine(g);
    return { x: (g.x1 + g.x2) / 2 + nx * 18, y: (g.y1 + g.y2) / 2 + ny * 18 };
  }
  if (g.type === 'point') return { x: g.x + 16, y: g.y - 16 };
  if (g.type === 'rect') return { x: g.x, y: g.y - g.h / 2 - 12 };
  if (g.type === 'poly' && g.points?.[0]) return { x: g.points[0].x, y: g.points[0].y - 14 };
  return { x: 0, y: 0 };
}

function drawObject(ctx, obj, view, pal, camera, print) {
  const g = getGeom(obj, view);
  if (!g) return;

  if (obj.kind === 'pipeline') {
    drawPipeBody(ctx, g, pal.pipeline, 14);
    const cap = pipelineCaption(obj);
    const p = captionOffset(g);
    drawLabelBubble(ctx, p.x, p.y, cap, pal, camera, 'center');
    return;
  }
  if (obj.kind === 'utility' || obj.kind === 'unknown') {
    const color = utilityColor(obj, print);
    const unknown = isUnknownUtility(obj);
    drawLine(ctx, g, color, unknown ? 3.2 : 4, unknown ? [10, 7] : null);
    if (!unknown) {
      const { ux, uy, len } = normalOfLine(g);
      const tick = 7;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let d = 16; d < len - 8; d += 28) {
        const x = g.x1 + ux * d;
        const y = g.y1 + uy * d;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
        void tick;
      }
      ctx.restore();
    }
    const cap = utilityCaption(obj);
    const p = captionOffset(g);
    drawLabelBubble(ctx, p.x, p.y, cap, pal, camera, 'center');
    return;
  }
  if (obj.kind === 'measurement') {
    drawDimension(ctx, g, obj, pal, camera);
    return;
  }
  if (obj.kind === 'label') {
    const text = String(obj.props?.text || '').trim() || 'Label';
    drawLabelBubble(ctx, g.x, g.y, text, pal, camera, 'center');
    return;
  }
  if (obj.kind === 'arrow') {
    drawLine(ctx, g, pal.text, 2);
    const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
    arrowHead(ctx, g.x2, g.y2, ang, 12, { measure: pal.text });
    if (obj.props?.text) {
      const p = captionOffset(g);
      drawLabelBubble(ctx, p.x, p.y, obj.props.text, pal, camera, 'center');
    }
    return;
  }
  if (obj.kind === 'north') {
    drawNorth(ctx, g, pal);
    return;
  }
  if (obj.kind === 'ground') {
    drawGround(ctx, g, pal);
    return;
  }
  if (obj.kind === 'excavation') {
    drawExcavation(ctx, g, obj, pal);
    return;
  }
  if (obj.kind === 'road') {
    drawRoad(ctx, g, pal);
    return;
  }
  if (obj.kind === 'fence') {
    drawFence(ctx, g, pal);
    return;
  }
  if (obj.kind === 'ditch') {
    drawDitch(ctx, g, pal);
    return;
  }
  if (obj.kind === 'valve') {
    drawValve(ctx, g, pal);
    return;
  }
  if (obj.kind === 'testStation') {
    drawTestStation(ctx, g, pal);
  }
}

function drawHandles(ctx, obj, view, pal, camera) {
  const g = getGeom(obj, view);
  if (!g) return;
  const r = Math.max(7, 9 / camera.scale);
  ctx.save();
  ctx.lineWidth = 2 / camera.scale;
  ctx.strokeStyle = pal.handle;
  ctx.fillStyle = pal.handleFill;

  const dot = (x, y) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  if (g.type === 'line') {
    dot(g.x1, g.y1);
    dot(g.x2, g.y2);
    dot((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2);
  } else if (g.type === 'point') {
    dot(g.x, g.y);
    if (obj.kind === 'north') {
      const rot = g.rotation || 0;
      dot(g.x + Math.sin(rot) * 28, g.y - Math.cos(rot) * 28);
    }
  } else if (g.type === 'rect') {
    dot(g.x, g.y);
    dot(g.x + g.w / 2, g.y + g.h / 2);
  } else if (g.type === 'poly') {
    for (const p of g.points) dot(p.x, p.y);
  }
  ctx.restore();
}

export function drawScene(ctx, opts) {
  const { record, view, selectionId, camera, width, height, print = false, showHandles = true } = opts;
  const pal = palette(print);
  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillStyle = pal.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(view === 'profile' ? 'PROFILE VIEW' : 'PLAN VIEW', 12, 18);
  ctx.fillText(
    view === 'profile' ? 'Grade up  ·  schematic (not to scale)' : 'Schematic — not to scale',
    12,
    height - 10
  );

  ctx.save();
  applyCamera(ctx, camera);
  if (!print) drawGrid(ctx, camera, width, height, pal);
  else {
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1 / camera.scale;
    ctx.strokeRect(
      camera.x + 8 / camera.scale,
      camera.y + 8 / camera.scale,
      (width - 16) / camera.scale,
      (height - 16) / camera.scale
    );
  }

  for (const obj of record.objects || []) {
    drawObject(ctx, obj, view, pal, camera, print);
  }
  if (showHandles && selectionId) {
    const sel = (record.objects || []).find((o) => o.id === selectionId);
    if (sel && getGeom(sel, view)) {
      const g = getGeom(sel, view);
      ctx.save();
      ctx.strokeStyle = pal.select;
      ctx.setLineDash([6 / camera.scale, 4 / camera.scale]);
      ctx.lineWidth = 2 / camera.scale;
      const b = geomBounds(g);
      if (b) ctx.strokeRect(b.minX - 8, b.minY - 8, b.maxX - b.minX + 16, b.maxY - b.minY + 16);
      ctx.restore();
      drawHandles(ctx, sel, view, pal, camera);
    }
  }
  ctx.restore();
  ctx.restore();
}

export function hitHandle(obj, view, wx, wy, camera) {
  const g = getGeom(obj, view);
  if (!g) return null;
  const thresh = 16 / camera.scale;
  const near = (x, y, id) => (dist(wx, wy, x, y) <= thresh ? id : null);

  if (g.type === 'line') {
    return (
      near(g.x1, g.y1, 'a') ||
      near(g.x2, g.y2, 'b') ||
      near((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2, 'mid')
    );
  }
  if (g.type === 'point') {
    if (obj.kind === 'north') {
      const rot = g.rotation || 0;
      const hx = g.x + Math.sin(rot) * 28;
      const hy = g.y - Math.cos(rot) * 28;
      const rotHit = near(hx, hy, 'rot');
      if (rotHit) return rotHit;
    }
    return near(g.x, g.y, 'body');
  }
  if (g.type === 'rect') {
    return near(g.x + g.w / 2, g.y + g.h / 2, 'se') || near(g.x, g.y, 'body');
  }
  if (g.type === 'poly') {
    for (let i = 0; i < g.points.length; i++) {
      const h = near(g.points[i].x, g.points[i].y, `p${i}`);
      if (h) return h;
    }
  }
  return null;
}

export function hitTest(record, view, wx, wy, camera) {
  const thresh = 18 / camera.scale;
  const list = record.objects || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const obj = list[i];
    const g = getGeom(obj, view);
    if (!g) continue;
    if (g.type === 'line' && distToSeg(wx, wy, g.x1, g.y1, g.x2, g.y2) <= thresh) return obj;
    if (g.type === 'point' && dist(wx, wy, g.x, g.y) <= thresh + 8) return obj;
    if (g.type === 'rect') {
      const hw = g.w / 2 + thresh;
      const hh = g.h / 2 + thresh;
      if (Math.abs(wx - g.x) <= hw && Math.abs(wy - g.y) <= hh) return obj;
    }
    if (g.type === 'poly') {
      for (let k = 0; k < g.points.length - 1; k++) {
        const a = g.points[k];
        const b = g.points[k + 1];
        if (distToSeg(wx, wy, a.x, a.y, b.x, b.y) <= thresh) return obj;
      }
    }
  }
  return null;
}

export function applyHandleDrag(obj, view, handle, wx, wy, origin, camera, snapTargets) {
  const thresh = 14 / camera.scale;
  let g = JSON.parse(JSON.stringify(origin));

  const snap = (x, y, other) => {
    let p = { x, y };
    if (other) p = snapAnglePoint(other.x, other.y, p.x, p.y);
    p = snapToTargets(p.x, p.y, snapTargets, thresh);
    return p;
  };

  if (g.type === 'line') {
    if (handle === 'a') {
      const p = snap(wx, wy, { x: g.x2, y: g.y2 });
      g.x1 = p.x;
      g.y1 = p.y;
    } else if (handle === 'b') {
      const p = snap(wx, wy, { x: g.x1, y: g.y1 });
      g.x2 = p.x;
      g.y2 = p.y;
    } else if (handle === 'mid' || handle === 'body') {
      const dx = wx - (origin.x1 + origin.x2) / 2;
      const dy = wy - (origin.y1 + origin.y2) / 2;
      g.x1 = origin.x1 + dx;
      g.y1 = origin.y1 + dy;
      g.x2 = origin.x2 + dx;
      g.y2 = origin.y2 + dy;
    }
  } else if (g.type === 'point') {
    if (handle === 'rot') {
      g.rotation = Math.atan2(wx - g.x, -(wy - g.y));
    } else {
      const p = snapToTargets(wx, wy, snapTargets, thresh);
      g.x = p.x;
      g.y = p.y;
    }
  } else if (g.type === 'rect') {
    if (handle === 'se') {
      g.w = Math.max(24, Math.abs(wx - g.x) * 2);
      g.h = Math.max(20, Math.abs(wy - g.y) * 2);
    } else {
      g.x = wx;
      g.y = wy;
    }
  } else if (g.type === 'poly' && handle?.startsWith('p')) {
    const idx = Number(handle.slice(1));
    if (Number.isFinite(idx) && g.points[idx]) {
      const p = snapToTargets(wx, wy, snapTargets, thresh);
      g.points[idx] = p;
    }
  } else if (g.type === 'poly' && handle === 'body') {
    const c = centroid(origin.points);
    const dx = wx - c.x;
    const dy = wy - c.y;
    g.points = origin.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  setGeom(obj, view, g);
}

function centroid(pts) {
  if (!pts?.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function moveObjectBy(obj, view, dx, dy) {
  const g = getGeom(obj, view);
  if (!g) return;
  if (g.type === 'line') setGeom(obj, view, { ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy });
  else if (g.type === 'point') setGeom(obj, view, { ...g, x: g.x + dx, y: g.y + dy });
  else if (g.type === 'rect') setGeom(obj, view, { ...g, x: g.x + dx, y: g.y + dy });
  else if (g.type === 'poly') setGeom(obj, view, { ...g, points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
}

export function renderViewCanvas(record, view, w = 1400, h = 1000, print = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const camera = fitCamera(record, view, w, h, 48);
  drawScene(ctx, {
    record,
    view,
    selectionId: null,
    camera,
    width: w,
    height: h,
    print,
    showHandles: false,
  });
  return canvas;
}

export async function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}
