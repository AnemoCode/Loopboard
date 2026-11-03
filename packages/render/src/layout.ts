import {
  arcPoint,
  arcTangent,
  arcThrough,
  byKey,
  type Dash,
  type DiagramElement,
  type Layer,
  type Link,
  type LoopMarker,
  type Point,
  type ShapeElement,
  type Style,
  type TextElement,
  type VariableNode,
} from '@cld/model';
import { LINE_HEIGHT, measureText, wrapText, type Font } from './text.js';
import type { Theme } from './theme.js';

// ------------------------------------------------------------------ primitives

interface Paint {
  stroke?: string;
  fill?: string;
  width?: number;
  dash?: Dash;
}

export type Prim =
  | ({ t: 'path'; d: string; cap?: 'round' | 'butt' } & Paint)
  | ({ t: 'rect'; x: number; y: number; w: number; h: number; rx?: number } & Paint)
  | ({ t: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & Paint)
  | {
      t: 'text';
      x: number;
      anchor: 'start' | 'middle' | 'end';
      lines: { text: string; y: number }[];
      font: Font;
      fill: string;
    };

/** Axis-aligned box, top-left based. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Boundary =
  | { kind: 'rect'; cx: number; cy: number; hw: number; hh: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'diamond'; cx: number; cy: number; hw: number; hh: number }
  /** Pointed left and right, flat top and bottom. */
  | { kind: 'hexagon'; cx: number; cy: number; hw: number; hh: number };

export interface ElementLayout {
  id: string;
  type: DiagramElement['type'];
  prims: Prim[];
  bbox: Box;
  /** Where links attach and get clipped (variable nodes). */
  boundary?: Boundary;
  /** Link geometry used by the editor for handles and hit-testing. */
  link?: {
    d: string;
    start: Point;
    end: Point;
    handle: Point;
    /**
     * Where the polarity sign sits (`at`) and where it would sit on the other side of the line
     * (`alt`). `auto`: the side wasn't chosen explicitly, so the layout may flip it to avoid
     * another sign.
     */
    polarity?: { at: Point; alt: Point; auto: boolean };
  };
  /** Area + font of editable text, for the inline editor overlay. */
  text?: { box: Box; font: Font; align: 'left' | 'center' | 'right'; value: string };
}

// ------------------------------------------------------------------ helpers

const r1 = (n: number) => Math.round(n * 10) / 10;
const DEFAULT_FONT_SIZE = 12;
const GAP = 3;

export function fontOf(style: Style | undefined, size = DEFAULT_FONT_SIZE): Font {
  return {
    family: style?.fontFamily ?? 'sans',
    size: style?.fontSize ?? size,
    bold: style?.bold ?? false,
    italic: style?.italic ?? false,
    ...(style?.underline ? { underline: true } : {}),
    ...(style?.strike ? { strike: true } : {}),
  };
}

/** Vertically centred text block around (x, cy). */
function textBlock(
  lines: string[],
  font: Font,
  x: number,
  cy: number,
  anchor: 'start' | 'middle' | 'end',
  fill: string,
): Prim {
  const lh = font.size * LINE_HEIGHT;
  const top = cy - (lines.length * lh) / 2;
  return {
    t: 'text',
    x: r1(x),
    anchor,
    font,
    fill,
    lines: lines.map((text, i) => ({ text, y: r1(top + i * lh + lh / 2 + font.size * 0.35) })),
  };
}

const textWidth = (lines: string[], font: Font) =>
  Math.max(0, ...lines.map((l) => measureText(l, font)));

/** Resolve a fill: undefined → theme default, null → none. */
const fillOf = (v: string | null | undefined, dflt: string | undefined) =>
  v === null ? undefined : (v ?? dflt);

function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const pointBox = (pts: Point[], pad = 0): Box =>
  unionBox(pts.map((p) => ({ x: p.x - pad, y: p.y - pad, w: pad * 2, h: pad * 2 })));

export function insideBoundary(b: Boundary, p: Point, gap = 0): boolean {
  if (b.kind === 'rect')
    return Math.abs(p.x - b.cx) <= b.hw + gap && Math.abs(p.y - b.cy) <= b.hh + gap;
  if (b.kind === 'diamond')
    return Math.abs(p.x - b.cx) / (b.hw + gap) + Math.abs(p.y - b.cy) / (b.hh + gap) <= 1;
  if (b.kind === 'hexagon') {
    const hw = b.hw + gap;
    const hh = b.hh + gap;
    const dy = Math.abs(p.y - b.cy);
    return dy <= hh && Math.abs(p.x - b.cx) <= hw - (hw / 2) * (dy / hh);
  }
  const rx = b.rx + gap;
  const ry = b.ry + gap;
  const dx = (p.x - b.cx) / rx;
  const dy = (p.y - b.cy) / ry;
  return dx * dx + dy * dy <= 1;
}

const boundaryCenter = (b: Boundary): Point => ({ x: b.cx, y: b.cy });

/** Hexagon outline: pointed left and right, flat top and bottom. */
const hexagonPath = (x: number, y: number, hw: number, hh: number) =>
  `M${r1(x - hw)} ${r1(y)}L${r1(x - hw / 2)} ${r1(y - hh)}L${r1(x + hw / 2)} ${r1(y - hh)}` +
  `L${r1(x + hw)} ${r1(y)}L${r1(x + hw / 2)} ${r1(y + hh)}L${r1(x - hw / 2)} ${r1(y + hh)}Z`;

// ------------------------------------------------------------------ nodes

const FORM_PAD_X = 10;
const FORM_PAD_Y = 6;

function layoutVariable(el: VariableNode, name: string, theme: Theme): ElementLayout {
  const font = fontOf(el.style);
  const display = el.isShadow ? `<${name}>` : name;
  const hasForm = el.form !== 'none';
  const wrapW = hasForm ? el.w - FORM_PAD_X * 2 : el.w;
  const lines = wrapText(display, font, wrapW);
  const tw = textWidth(lines, font);
  const th = lines.length * font.size * LINE_HEIGHT;
  const textColor = el.style?.textColor ?? (el.isShadow ? theme.mutedText : theme.text);
  const prims: Prim[] = [];
  let hw: number;
  let hh: number;
  if (hasForm) {
    hw = Math.max(el.w, tw + FORM_PAD_X * 2) / 2;
    hh = Math.max(el.h, th + FORM_PAD_Y * 2) / 2;
  } else {
    hw = Math.max(tw, 16) / 2 + 3;
    hh = th / 2 + 2;
  }
  const stroke =
    el.style?.stroke === null
      ? undefined
      : (el.style?.stroke ?? (hasForm ? theme.nodeStroke : undefined));
  const fill = fillOf(el.style?.fill, undefined);
  const paint: Paint = { stroke, fill, width: el.style?.strokeWidth ?? 1.25, dash: el.style?.dash };
  if (el.form === 'hexagon') {
    // A text box of half size (a, b) fits when b ≤ hh and a ≤ hw − hw/2 · b/hh.
    hh = Math.max(el.h / 2, (th / 2 + FORM_PAD_Y / 2) * 1.25);
    hw = Math.max(el.w / 2, (tw / 2 + FORM_PAD_X / 2) / (1 - (th / 2 + FORM_PAD_Y / 2) / (2 * hh)));
  }
  if (el.form === 'ellipse' || el.form === 'diamond') {
    // The text box must fit inside: an ellipse needs √2 times its half extents, a diamond twice.
    const k = el.form === 'ellipse' ? Math.SQRT2 : 2;
    hw = Math.max(el.w / 2, (tw / 2 + FORM_PAD_X / 2) * k);
    hh = Math.max(el.h / 2, (th / 2 + FORM_PAD_Y / 2) * k);
  }
  const box = { x: el.x - hw, y: el.y - hh, w: hw * 2, h: hh * 2 };
  if (el.form === 'ellipse') {
    prims.push({ t: 'ellipse', cx: el.x, cy: el.y, rx: r1(hw), ry: r1(hh), ...paint });
  } else if (el.form === 'diamond') {
    const [x, y, w, h] = [el.x, el.y, r1(hw), r1(hh)];
    prims.push({
      t: 'path',
      d: `M${r1(x)} ${r1(y - h)}L${r1(x + w)} ${r1(y)}L${r1(x)} ${r1(y + h)}L${r1(x - w)} ${r1(y)}Z`,
      ...paint,
    });
  } else if (el.form === 'hexagon') {
    prims.push({ t: 'path', d: hexagonPath(el.x, el.y, hw, hh), ...paint });
  } else if (hasForm || stroke || fill) {
    prims.push({
      t: 'rect',
      x: r1(el.x - hw),
      y: r1(el.y - hh),
      w: r1(hw * 2),
      h: r1(hh * 2),
      rx: el.form === 'rounded' ? Math.min(hh, 12) : 2,
      ...paint,
    });
  }
  const align = el.style?.align ?? 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const tx = align === 'left' ? el.x - tw / 2 : align === 'right' ? el.x + tw / 2 : el.x;
  prims.push(textBlock(lines, font, tx, el.y, anchor, textColor));
  const boundary: Boundary =
    el.form === 'ellipse'
      ? { kind: 'ellipse', cx: el.x, cy: el.y, rx: hw, ry: hh }
      : el.form === 'diamond' || el.form === 'hexagon'
        ? { kind: el.form, cx: el.x, cy: el.y, hw, hh }
        : { kind: 'rect', cx: el.x, cy: el.y, hw, hh };
  const bbox = box;
  return {
    id: el.id,
    type: 'variable',
    prims,
    bbox,
    boundary,
    text: {
      box: { x: el.x - wrapW / 2, y: el.y - th / 2, w: wrapW, h: th },
      font,
      align,
      value: name,
    },
  };
}

function layoutShape(el: ShapeElement, theme: Theme): ElementLayout {
  const hw = el.w / 2;
  const hh = el.h / 2;
  const paint: Paint = {
    stroke: el.style?.stroke === null ? undefined : (el.style?.stroke ?? theme.shapeStroke),
    fill: fillOf(el.style?.fill, theme.shapeFill),
    width: el.style?.strokeWidth ?? 1.25,
    dash: el.style?.dash,
  };
  const prims: Prim[] = [];
  if (el.shape === 'ellipse')
    prims.push({ t: 'ellipse', cx: el.x, cy: el.y, rx: hw, ry: hh, ...paint });
  else if (el.shape === 'hexagon')
    prims.push({ t: 'path', d: hexagonPath(el.x, el.y, hw, hh), ...paint });
  else if (el.shape === 'diamond')
    prims.push({
      t: 'path',
      d: `M${el.x} ${el.y - hh}L${el.x + hw} ${el.y}L${el.x} ${el.y + hh}L${el.x - hw} ${el.y}Z`,
      ...paint,
    });
  else
    prims.push({
      t: 'rect',
      x: el.x - hw,
      y: el.y - hh,
      w: el.w,
      h: el.h,
      rx: el.shape === 'rounded' ? Math.min(16, hh) : 0,
      ...paint,
    });
  const font = fontOf(el.style, 13);
  const value = el.text ?? '';
  // Wrap text to what fits inside the outline.
  const fit =
    el.shape === 'diamond' ? 0.5 : el.shape === 'ellipse' ? 0.7 : el.shape === 'hexagon' ? 0.6 : 1;
  const inner = Math.max(10, el.w * fit - 20 * fit);
  const lines = value ? wrapText(value, font, inner) : [];
  if (lines.length)
    prims.push(textBlock(lines, font, el.x, el.y, 'middle', el.style?.textColor ?? theme.text));
  const th = Math.max(1, lines.length) * font.size * LINE_HEIGHT;
  return {
    id: el.id,
    type: 'shape',
    prims,
    bbox: { x: el.x - hw, y: el.y - hh, w: el.w, h: el.h },
    text: {
      box: { x: el.x - inner / 2, y: el.y - th / 2, w: inner, h: th },
      font,
      align: 'center',
      value,
    },
  };
}

function layoutText(el: TextElement, theme: Theme): ElementLayout {
  const font = fontOf(el.style);
  const lines = wrapText(el.text || ' ', font, el.w);
  const th = lines.length * font.size * LINE_HEIGHT;
  const h = Math.max(el.h, th);
  const align = el.style?.align ?? 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x0 = el.x - el.w / 2;
  const tx = align === 'left' ? x0 : align === 'right' ? x0 + el.w : el.x;
  const prims: Prim[] = [];
  const stroke = el.style?.stroke ?? undefined;
  const fill = el.style?.fill ?? undefined;
  if (stroke || fill)
    prims.push({
      t: 'rect',
      x: x0 - 6,
      y: el.y - h / 2 - 4,
      w: el.w + 12,
      h: h + 8,
      rx: 4,
      stroke,
      fill,
      width: el.style?.strokeWidth ?? 1,
      dash: el.style?.dash,
    });
  if (el.text)
    prims.push(textBlock(lines, font, tx, el.y, anchor, el.style?.textColor ?? theme.text));
  return {
    id: el.id,
    type: 'text',
    prims,
    bbox: { x: x0, y: el.y - h / 2, w: el.w, h },
    text: { box: { x: x0, y: el.y - th / 2, w: el.w, h: th }, font, align, value: el.text },
  };
}

function arrowHead(
  tip: Point,
  dir: Point,
  size: number,
  color: string,
  kind: 'arrow' | 'open',
): Prim {
  const bx = tip.x - dir.x * size;
  const by = tip.y - dir.y * size;
  const nx = -dir.y * size * 0.42;
  const ny = dir.x * size * 0.42;
  const d = `M${r1(bx + nx)} ${r1(by + ny)}L${r1(tip.x)} ${r1(tip.y)}L${r1(bx - nx)} ${r1(by - ny)}`;
  return kind === 'arrow'
    ? { t: 'path', d: `${d}Z`, fill: color, stroke: color, width: 1 }
    : { t: 'path', d, stroke: color, width: 1.5, cap: 'round' };
}

function layoutLoop(el: LoopMarker, theme: Theme): ElementLayout {
  const rr = Math.max(9, el.r * 0.55);
  const color = el.style?.color ?? theme.loop;
  const width = el.style?.width ?? 1.75;
  const cw = el.direction === 'cw';
  const gap = Math.PI / 5;
  const a0 = -Math.PI / 2 + (cw ? gap : -gap);
  const sweep = (Math.PI * 2 - gap * 2) * (cw ? 1 : -1);
  const p = (a: number) => ({ x: el.x + rr * Math.cos(a), y: el.y + rr * Math.sin(a) });
  const start = p(a0);
  const end = p(a0 + sweep);
  const head = Math.max(6, rr * 0.55);
  // Shorten the arc so the line ends under the arrowhead.
  const endTrim = p(a0 + sweep - ((cw ? 1 : -1) * (head * 0.6)) / rr);
  const tangent = {
    x: -Math.sin(a0 + sweep) * (cw ? 1 : -1),
    y: Math.cos(a0 + sweep) * (cw ? 1 : -1),
  };
  const prims: Prim[] = [
    {
      t: 'path',
      d: `M${r1(start.x)} ${r1(start.y)}A${r1(rr)} ${r1(rr)} 0 1 ${cw ? 1 : 0} ${r1(endTrim.x)} ${r1(endTrim.y)}`,
      stroke: color,
      width,
      cap: 'round',
    },
    arrowHead(
      { x: end.x + tangent.x * head * 0.35, y: end.y + tangent.y * head * 0.35 },
      tangent,
      head,
      color,
      'arrow',
    ),
  ];
  const font: Font = { ...fontOf(el.style, Math.round(rr * 0.85)), bold: el.style?.bold ?? true };
  const textColor = el.style?.textColor ?? color;
  prims.push(textBlock([el.label], font, el.x, el.y, 'middle', textColor));
  const boxes: Box[] = [{ x: el.x - rr - 4, y: el.y - rr - 4, w: rr * 2 + 8, h: rr * 2 + 8 }];
  if (el.name) {
    const nf: Font = { ...fontOf(el.style, 11), bold: false };
    const lines = wrapText(el.name, nf, 140);
    const nh = lines.length * nf.size * LINE_HEIGHT;
    const top = el.y + rr + 6;
    prims.push(textBlock(lines, nf, el.x, top + nh / 2, 'middle', textColor));
    const nw = textWidth(lines, nf);
    boxes.push({ x: el.x - nw / 2, y: top, w: nw, h: nh });
  }
  return { id: el.id, type: 'loop', prims, bbox: unionBox(boxes) };
}

// ------------------------------------------------------------------ links

interface Curve {
  at(t: number): Point;
  tan(t: number): Point;
  /** Length of the whole curve (t ∈ [0,1]). */
  length: number;
  /** SVG path from t0 to t1. */
  path(t0: number, t1: number): string;
  /** Side normal pointing away from the inside of the bend (or left for straight lines). */
  outward(t: number): Point;
}

function lineCurve(p0: Point, p1: Point): Curve {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const at = (t: number) => ({ x: p0.x + dx * t, y: p0.y + dy * t });
  return {
    at,
    tan: () => ({ x: dx / len, y: dy / len }),
    length: len,
    path: (t0, t1) => {
      const a = at(t0);
      const b = at(t1);
      return `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`;
    },
    outward: () => ({ x: dy / len, y: -dx / len }),
  };
}

function arcCurve(p0: Point, c: Point, p1: Point): Curve {
  const arc = arcThrough(p0, c, p1);
  if (!arc) return lineCurve(p0, p1);
  const at = (t: number) => arcPoint(arc, t);
  return {
    at,
    tan: (t) => arcTangent(arc, t),
    length: Math.abs(arc.delta) * arc.r,
    path: (t0, t1) => {
      const a = at(t0);
      const b = at(t1);
      const sweep = arc.delta * (t1 - t0);
      return `M${r1(a.x)} ${r1(a.y)}A${r1(arc.r)} ${r1(arc.r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${r1(b.x)} ${r1(b.y)}`;
    },
    outward: (t) => {
      const p = at(t);
      const l = Math.hypot(p.x - arc.cx, p.y - arc.cy) || 1;
      return { x: (p.x - arc.cx) / l, y: (p.y - arc.cy) / l };
    },
  };
}

/** First parameter (searching from `from` towards `to`) where the curve leaves the boundary. */
function exitParam(curve: Curve, b: Boundary, from: number, to: number): number {
  const steps = 48;
  let prev = from;
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    if (!insideBoundary(b, curve.at(t), GAP)) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (insideBoundary(b, curve.at(mid), GAP)) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    prev = t;
  }
  return from;
}

function selfLoop(b: Boundary): {
  d: string;
  tip: Point;
  dir: Point;
  mid: Point;
  apex: Point;
} {
  const hw = b.kind === 'ellipse' ? b.rx : b.hw;
  const hh = b.kind === 'ellipse' ? b.ry : b.hh;
  const sx = b.cx + hw * 0.35;
  const top = b.cy - hh - GAP;
  const ex = b.cx + hw + GAP;
  const ey = b.cy - hh * 0.3;
  const c1 = { x: sx + 10, y: top - 46 };
  const c2 = { x: ex + 46, y: ey - 10 };
  const d = `M${r1(sx)} ${r1(top)}C${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${r1(ex)} ${r1(ey)}`;
  const dl = Math.hypot(ex - c2.x, ey - c2.y);
  return {
    d,
    tip: { x: ex, y: ey },
    dir: { x: (ex - c2.x) / dl, y: (ey - c2.y) / dl },
    mid: { x: ex + 18, y: top - 18 },
    // Point on the curve at t = 0.5.
    apex: { x: (sx + 3 * c1.x + 3 * c2.x + ex) / 8, y: (top + 3 * c1.y + 3 * c2.y + ey) / 8 },
  };
}

export const POLARITY_GLYPH: Record<string, string> = { '+': '+', '-': '–', '?': '?' };

function layoutLink(
  el: Link,
  from: ElementLayout | undefined,
  to: ElementLayout | undefined,
  theme: Theme,
  /** Put an automatically placed polarity sign on the other side (to avoid a collision). */
  flipPolarity = false,
): ElementLayout | null {
  const fb = from?.boundary;
  const tb = to?.boundary;
  if (!fb || !tb) return null;
  const color = el.style?.color ?? theme.link;
  const width = el.style?.width ?? 1.25;
  const head = el.style?.head ?? 'arrow';
  const headSize = 7 + width * 2;
  const prims: Prim[] = [];
  const polFont: Font = { family: 'sans', size: 14, bold: true, italic: false };
  // Outside (default) = the convex side of the curve; inside = towards the loop it closes.
  const autoSide = el.style?.polaritySide === undefined;
  const inside = autoSide ? flipPolarity : el.style?.polaritySide === 'inside';

  if (el.from === el.to) {
    const s = selfLoop(fb);
    prims.push({ t: 'path', d: s.d, stroke: color, width, dash: el.style?.dash, cap: 'round' });
    if (head !== 'none') prims.push(arrowHead(s.tip, s.dir, headSize, color, head));
    if (el.polarity) {
      // Inside: in the gap between the curl and the node, just under the curve's apex.
      const pos = inside
        ? (() => {
            const dx = fb.cx - s.apex.x;
            const dy = fb.cy - s.apex.y;
            const l = Math.hypot(dx, dy) || 1;
            return { x: s.apex.x + (dx / l) * 11, y: s.apex.y + (dy / l) * 11 };
          })()
        : { x: s.mid.x + 8, y: s.mid.y - 8 };
      prims.push(textBlock([POLARITY_GLYPH[el.polarity]!], polFont, pos.x, pos.y, 'middle', color));
    }
    return {
      id: el.id,
      type: 'link',
      prims,
      bbox: pointBox([s.tip, s.mid, { x: fb.cx, y: fb.cy - 60 }], 12),
      link: { d: s.d, start: s.tip, end: s.tip, handle: s.mid },
    };
  }

  const p0 = boundaryCenter(fb);
  const p1 = boundaryCenter(tb);
  const curve = el.control ? arcCurve(p0, el.control, p1) : lineCurve(p0, p1);
  let t0 = exitParam(curve, fb, 0, 1);
  let t1 = exitParam(curve, tb, 1, 0);
  if (t1 <= t0) {
    t0 = 0;
    t1 = 1;
  }
  const len = curve.length || 1;
  const tip = curve.at(t1);
  const dir = curve.tan(t1);
  const lineEnd = head === 'arrow' ? Math.max(t0, t1 - (headSize * 0.7) / len) : t1;
  const d = curve.path(t0, lineEnd);
  prims.push({ t: 'path', d, stroke: color, width, dash: el.style?.dash, cap: 'round' });
  if (head !== 'none') prims.push(arrowHead(tip, dir, headSize, color, head));

  const extra: Point[] = [];
  let polarity: { at: Point; alt: Point; auto: boolean } | undefined;
  if (el.polarity) {
    const tp = Math.max(t0, t1 - (headSize + 7) / len);
    const p = curve.at(tp);
    const n = curve.outward(tp);
    const off = inside ? -10 : 10;
    const pos = { x: p.x + n.x * off, y: p.y + n.y * off };
    prims.push(textBlock([POLARITY_GLYPH[el.polarity]!], polFont, pos.x, pos.y, 'middle', color));
    extra.push(pos);
    polarity = { at: pos, alt: { x: p.x - n.x * off, y: p.y - n.y * off }, auto: autoSide };
  }
  const tm = (t0 + t1) / 2;
  if (el.delay) {
    const m = curve.at(tm);
    const tg = curve.tan(tm);
    const n = { x: -tg.y, y: tg.x };
    const segs = [-2.5, 2.5].map((o) => {
      const cx = m.x + tg.x * o;
      const cy = m.y + tg.y * o;
      return `M${r1(cx - n.x * 7)} ${r1(cy - n.y * 7)}L${r1(cx + n.x * 7)} ${r1(cy + n.y * 7)}`;
    });
    prims.push({
      t: 'path',
      d: segs.join(''),
      stroke: color,
      width: Math.max(1.25, width),
      cap: 'butt',
    });
  }
  if (el.label) {
    const m = curve.at(tm);
    const n = curve.outward(tm);
    const lf: Font = { ...fontOf(el.style, 11), bold: false };
    const pos = { x: m.x - n.x * 12, y: m.y - n.y * 12 };
    prims.push(
      textBlock([el.label], lf, pos.x, pos.y, 'middle', el.style?.textColor ?? theme.mutedText),
    );
    const lw = measureText(el.label, lf) / 2;
    extra.push({ x: pos.x - lw, y: pos.y }, { x: pos.x + lw, y: pos.y });
  }
  const samples = Array.from({ length: 9 }, (_, i) => curve.at(t0 + ((t1 - t0) * i) / 8));
  const handle = el.control ?? curve.at(0.5);
  return {
    id: el.id,
    type: 'link',
    prims,
    bbox: pointBox([...samples, ...extra], 8),
    link: { d: curve.path(t0, t1), start: curve.at(t0), end: tip, handle, polarity },
  };
}

/** Polarity signs closer than this (centre to centre) read as one. */
const SIGN_CLEARANCE = 18;

/**
 * Links whose automatically placed polarity sign should move to the other side of the line, because
 * it would overlap another sign (e.g. two links arriving at the same variable from either side).
 * For each colliding pair, picks the flip (one, the other, or both) that separates the signs most.
 */
export function polarityFlips(signs: { id: string; at: Point; alt: Point; auto: boolean }[]) {
  const flipped = new Set<string>();
  const pos = (s: (typeof signs)[number], flip: Set<string>) => (flip.has(s.id) ? s.alt : s.at);
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < signs.length; i++) {
    for (let j = i + 1; j < signs.length; j++) {
      const a = signs[i]!;
      const b = signs[j]!;
      if (dist(pos(a, flipped), pos(b, flipped)) >= SIGN_CLEARANCE) continue;
      const options = [[a], [b], [a, b]].filter((o) => o.every((s) => s.auto));
      let best: { flip: Set<string>; score: number } | null = null;
      for (const o of options) {
        const flip = new Set(flipped);
        for (const s of o) {
          if (flip.has(s.id)) flip.delete(s.id);
          else flip.add(s.id);
        }
        // Separation of this pair, but never at the cost of landing on a third sign.
        let score = dist(pos(a, flip), pos(b, flip));
        for (const s of o)
          for (const other of signs)
            if (other !== a && other !== b)
              score = Math.min(score, dist(pos(s, flip), pos(other, flip)));
        if (!best || score > best.score + 0.5) best = { flip, score };
      }
      if (best && best.score > dist(pos(a, flipped), pos(b, flipped))) {
        flipped.clear();
        for (const id of best.flip) flipped.add(id);
      }
    }
  }
  return flipped;
}

// ------------------------------------------------------------------ diagram

export interface LayoutInput {
  elements: Record<string, DiagramElement>;
  layers: Record<string, Layer>;
  variableName: (variableId: string) => string;
}

export interface DiagramLayout {
  byId: Map<string, ElementLayout>;
  /** Visible elements in paint order (layer order, then z). */
  order: string[];
  bbox: Box | null;
}

/** Memoises layouts by input identity so unchanged elements keep the same layout object. */
export class LayoutCache {
  private entries = new Map<string, { deps: unknown[]; layout: ElementLayout | null }>();
  get(id: string, deps: unknown[], make: () => ElementLayout | null): ElementLayout | null {
    const hit = this.entries.get(id);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i]))
      return hit.layout;
    const layout = make();
    this.entries.set(id, { deps, layout });
    return layout;
  }
  prune(keep: Set<string>) {
    for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
  }
}

export function paintOrder(
  elements: Record<string, DiagramElement>,
  layers: Record<string, Layer>,
  includeHidden = false,
): DiagramElement[] {
  const sortedLayers = Object.values(layers).sort(byKey((l) => l.order));
  const rank = new Map(sortedLayers.map((l, i) => [l.id, i]));
  return Object.values(elements)
    .filter((e) => {
      const l = layers[e.layerId];
      return includeHidden || !l || l.visible;
    })
    .sort(
      (a, b) =>
        (rank.get(a.layerId) ?? 0) - (rank.get(b.layerId) ?? 0) ||
        byKey<DiagramElement>((e) => e.z)(a, b),
    );
}

export function layoutDiagram(
  input: LayoutInput,
  theme: Theme,
  cache = new LayoutCache(),
  includeHidden = false,
): DiagramLayout {
  const byId = new Map<string, ElementLayout>();
  const all = Object.values(input.elements);
  // Nodes first (links depend on their boundaries), regardless of visibility.
  for (const el of all) {
    if (el.type === 'link') continue;
    const layout =
      el.type === 'variable'
        ? cache.get(el.id, [el, input.variableName(el.variableId), theme], () =>
            layoutVariable(el, input.variableName(el.variableId), theme),
          )
        : el.type === 'loop'
          ? cache.get(el.id, [el, theme], () => layoutLoop(el, theme))
          : el.type === 'shape'
            ? cache.get(el.id, [el, theme], () => layoutShape(el, theme))
            : cache.get(el.id, [el, theme], () => layoutText(el, theme));
    if (layout) byId.set(el.id, layout);
  }
  const links: Link[] = [];
  for (const el of all) {
    if (el.type !== 'link') continue;
    links.push(el);
    const from = byId.get(el.from);
    const to = byId.get(el.to);
    const layout = cache.get(el.id, [el, from, to, theme], () => layoutLink(el, from, to, theme));
    if (layout) byId.set(el.id, layout);
  }
  // Keep polarity signs apart: links whose sign would overlap another one get it on the other side.
  const signs = links.flatMap((l) => {
    const p = byId.get(l.id)?.link?.polarity;
    return p ? [{ id: l.id, ...p }] : [];
  });
  const flips = polarityFlips(signs);
  const keep = new Set(all.map((e) => e.id));
  for (const el of links) {
    if (!flips.has(el.id)) continue;
    const from = byId.get(el.from);
    const to = byId.get(el.to);
    const key = `${el.id}:flipped`;
    keep.add(key);
    const layout = cache.get(key, [el, from, to, theme], () =>
      layoutLink(el, from, to, theme, true),
    );
    if (layout) byId.set(el.id, layout);
  }
  cache.prune(keep);
  const order = paintOrder(input.elements, input.layers, includeHidden)
    .map((e) => e.id)
    .filter((id) => byId.has(id));
  const boxes = order.map((id) => byId.get(id)!.bbox);
  return { byId, order, bbox: boxes.length ? unionBox(boxes) : null };
}

export { unionBox };
