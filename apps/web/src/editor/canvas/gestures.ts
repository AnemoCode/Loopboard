import { bendFor, controlFromBend, type DiagramElement, type Point } from '@cld/model';
import type { Box } from '@cld/render';
import type { Gesture } from '../store';

/** Apply an in-progress gesture to the element map, returning new objects only for affected elements. */
export function applyGesture(elements: Record<string, DiagramElement>, g: Gesture | null): Record<string, DiagramElement> {
  if (!g) return elements;
  if (g.kind === 'move') {
    if (!g.dx && !g.dy) return elements;
    const moved = new Set(g.ids.filter((id) => elements[id] && elements[id]!.type !== 'link'));
    if (!moved.size) return elements;
    const out = { ...elements };
    for (const id of moved) {
      const el = elements[id] as Exclude<DiagramElement, { type: 'link' }>;
      out[id] = { ...el, x: el.x + g.dx, y: el.y + g.dy };
    }
    for (const el of Object.values(elements)) {
      if (el.type !== 'link' || !el.control) continue;
      const fm = moved.has(el.from);
      const tm = moved.has(el.to);
      if (!fm && !tm) continue;
      if (fm && tm) {
        out[el.id] = { ...el, control: { x: el.control.x + g.dx, y: el.control.y + g.dy } };
        continue;
      }
      const a = elements[el.from] as { x: number; y: number } | undefined;
      const b = elements[el.to] as { x: number; y: number } | undefined;
      if (!a || !b) continue;
      const bend = bendFor(a, b, el.control);
      const na = fm ? { x: a.x + g.dx, y: a.y + g.dy } : a;
      const nb = tm ? { x: b.x + g.dx, y: b.y + g.dy } : b;
      out[el.id] = { ...el, control: controlFromBend(na, nb, bend) };
    }
    return out;
  }
  if (g.kind === 'resize') {
    const el = elements[g.id];
    if (!el || el.type === 'link') return elements;
    if (el.type === 'loop') return { ...elements, [g.id]: { ...el, r: Math.max(10, Math.round(g.w / 2)) } };
    return { ...elements, [g.id]: { ...el, x: g.x, y: g.y, w: g.w, h: g.h } };
  }
  if (g.kind === 'curve') {
    const el = elements[g.id];
    if (!el || el.type !== 'link') return elements;
    return { ...elements, [g.id]: { ...el, control: g.control } };
  }
  return elements;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** Resize handles offered for an element. */
export function handlesFor(el: DiagramElement): Handle[] {
  switch (el.type) {
    case 'variable':
      return el.form === 'none' ? ['w', 'e'] : ['nw', 'ne', 'sw', 'se'];
    case 'text':
      return ['w', 'e'];
    case 'shape':
      return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    case 'loop':
      return ['se'];
    default:
      return [];
  }
}

/** The box a handle manipulates (variables without a form resize their text-wrap width). */
export function resizeBox(el: DiagramElement, bbox: Box): Box {
  if (el.type === 'variable' && el.form === 'none') {
    const w = Math.max(el.w, bbox.w);
    return { x: el.x - w / 2, y: bbox.y, w, h: bbox.h };
  }
  if (el.type === 'loop') return { x: el.x - el.r, y: el.y - el.r, w: el.r * 2, h: el.r * 2 };
  if (el.type === 'variable') return bbox;
  if (el.type === 'link') return bbox;
  return { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h };
}

export function handlePoint(box: Box, h: Handle): Point {
  const x = h.includes('w') ? box.x : h.includes('e') ? box.x + box.w : box.x + box.w / 2;
  const y = h.includes('n') ? box.y : h.includes('s') ? box.y + box.h : box.y + box.h / 2;
  return { x, y };
}

/** New center box (x/y = center) for dragging `h` of `el` to world point `p`. */
export function resizeTo(el: DiagramElement, start: Box, h: Handle, p: Point, keepRatio: boolean): { x: number; y: number; w: number; h: number } {
  const MIN = 24;
  if (el.type === 'loop') {
    const r = Math.max(10, Math.max(Math.abs(p.x - el.x), Math.abs(p.y - el.y)));
    return { x: el.x, y: el.y, w: r * 2, h: r * 2 };
  }
  if (el.type === 'variable') {
    if (el.form === 'none') {
      const w = Math.max(MIN, Math.round(Math.abs(p.x - el.x) * 2));
      return { x: el.x, y: el.y, w, h: el.h };
    }
    // Forms resize symmetrically around the center (keeps links stable).
    const w = Math.max(MIN, Math.round(Math.abs(p.x - el.x) * 2));
    const hh = Math.max(MIN, Math.round(Math.abs(p.y - el.y) * 2));
    return { x: el.x, y: el.y, w, h: hh };
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (h.includes('w')) x0 = Math.min(p.x, x1 - MIN);
  if (h.includes('e')) x1 = Math.max(p.x, x0 + MIN);
  if (h.includes('n')) y0 = Math.min(p.y, y1 - MIN);
  if (h.includes('s')) y1 = Math.max(p.y, y0 + MIN);
  if (keepRatio && h.length === 2 && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const w = x1 - x0;
    const hgt = w / ratio;
    if (h.includes('n')) y0 = y1 - hgt;
    else y1 = y0 + hgt;
  }
  if (el.type === 'text') {
    y0 = start.y;
    y1 = start.y + start.h;
  }
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** Snap a move so the dragged box's center/edges align with other elements. Returns adjusted delta + guides. */
export function snapMove(
  moving: Box,
  others: Box[],
  dx: number,
  dy: number,
  threshold: number,
): { dx: number; dy: number; guides: { x?: number; y?: number } | null } {
  const mx = [moving.x + dx, moving.x + dx + moving.w / 2, moving.x + dx + moving.w];
  const my = [moving.y + dy, moving.y + dy + moving.h / 2, moving.y + dy + moving.h];
  let bestX: { d: number; at: number } | null = null;
  let bestY: { d: number; at: number } | null = null;
  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w];
    const oy = [o.y, o.y + o.h / 2, o.y + o.h];
    for (let i = 0; i < 3; i++) {
      // Only compare like with like (centers with centers, edges with edges) to avoid noisy guides.
      const d = ox[i]! - mx[i]!;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: ox[i]! };
      const e = oy[i]! - my[i]!;
      if (Math.abs(e) <= threshold && (!bestY || Math.abs(e) < Math.abs(bestY.d))) bestY = { d: e, at: oy[i]! };
    }
  }
  if (!bestX && !bestY) return { dx, dy, guides: null };
  return {
    dx: dx + (bestX?.d ?? 0),
    dy: dy + (bestY?.d ?? 0),
    guides: { ...(bestX ? { x: bestX.at } : {}), ...(bestY ? { y: bestY.at } : {}) },
  };
}

export const boxesIntersect = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const boxContains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
