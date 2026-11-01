import type { Point } from './types.js';

/** Bend of an arc control point relative to its chord: `t` along, `s` across (both chord-normalised). */
export interface Bend {
  t: number;
  s: number;
}

export function bendFor(p0: Point, p1: Point, c: Point): Bend {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const l2 = dx * dx + dy * dy || 1;
  const vx = c.x - p0.x;
  const vy = c.y - p0.y;
  return { t: (vx * dx + vy * dy) / l2, s: (dx * vy - dy * vx) / l2 };
}

export function controlFromBend(p0: Point, p1: Point, b: Bend): Point {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  return { x: p0.x + b.t * dx - b.s * dy, y: p0.y + b.t * dy + b.s * dx };
}

/** Circular arc from p0 through c to p1: start angle `a0`, signed sweep `delta` (radians). */
export interface Arc {
  cx: number;
  cy: number;
  r: number;
  a0: number;
  delta: number;
}

const TAU = Math.PI * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Returns null when the three points are (nearly) collinear, i.e. the link is straight. */
export function arcThrough(p0: Point, c: Point, p1: Point): Arc | null {
  const d = 2 * (p0.x * (c.y - p1.y) + c.x * (p1.y - p0.y) + p1.x * (p0.y - c.y));
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (Math.abs(d) < 1e-9) return null;
  const s0 = p0.x * p0.x + p0.y * p0.y;
  const sc = c.x * c.x + c.y * c.y;
  const s1 = p1.x * p1.x + p1.y * p1.y;
  const cx = (s0 * (c.y - p1.y) + sc * (p1.y - p0.y) + s1 * (p0.y - c.y)) / d;
  const cy = (s0 * (p1.x - c.x) + sc * (p0.x - p1.x) + s1 * (c.x - p0.x)) / d;
  const r = Math.hypot(p0.x - cx, p0.y - cy);
  if (chord > 0 && r > chord * 60) return null;
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const ac = Math.atan2(c.y - cy, c.x - cx);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  const sweep1 = mod(a1 - a0, TAU);
  const sweepC = mod(ac - a0, TAU);
  const delta = sweepC < sweep1 ? sweep1 : sweep1 - TAU;
  return { cx, cy, r, a0, delta };
}

export const arcPoint = (arc: Arc, t: number): Point => {
  const a = arc.a0 + arc.delta * t;
  return { x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) };
};

/** Unit tangent in direction of travel. */
export const arcTangent = (arc: Arc, t: number): Point => {
  const a = arc.a0 + arc.delta * t;
  const s = Math.sign(arc.delta) || 1;
  return { x: -Math.sin(a) * s, y: Math.cos(a) * s };
};

/** Signed area (screen coords, y down): positive = clockwise on screen. */
export function signedArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}
