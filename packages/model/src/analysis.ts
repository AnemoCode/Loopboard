import { centroid, signedArea } from './geometry.js';
import type { Diagram, LoopMarker, Point, Polarity } from './types.js';

export interface FoundLoop {
  /** Stable key: variable ids in canonical rotation. */
  key: string;
  variableIds: string[];
  linkIds: string[];
  /** R = reinforcing (even number of negative links), B = balancing, ? = a link lacks polarity. */
  kind: 'R' | 'B' | '?';
  direction: 'cw' | 'ccw';
  center: Point;
}

export interface LoopSearch {
  loops: FoundLoop[];
  truncated: boolean;
}

/**
 * Enumerate the elementary feedback loops of a diagram (simple cycles of the variable graph).
 * Search is bounded so pathological graphs stay responsive.
 */
export function findLoops(diagram: Diagram, maxLoops = 200, maxLength = 14): LoopSearch {
  const pos = new Map<string, Point>();
  const elementVar = new Map<string, string>();
  for (const el of Object.values(diagram.elements)) {
    if (el.type !== 'variable') continue;
    elementVar.set(el.id, el.variableId);
    if (!pos.has(el.variableId) || !el.isShadow) pos.set(el.variableId, { x: el.x, y: el.y });
  }
  const nodes = [...pos.keys()].sort();
  const index = new Map(nodes.map((n, i) => [n, i]));
  const adj: { to: number; link: string; polarity: Polarity }[][] = nodes.map(() => []);
  const seen = new Set<string>();
  const links = Object.values(diagram.elements)
    .filter((e) => e.type === 'link')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const l of links) {
    const a = elementVar.get(l.from);
    const b = elementVar.get(l.to);
    if (a === undefined || b === undefined) continue;
    const k = `${a}>${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    adj[index.get(a)!]!.push({ to: index.get(b)!, link: l.id, polarity: l.polarity });
  }

  const loops: FoundLoop[] = [];
  let truncated = false;
  const path: number[] = [];
  const pathLinks: { link: string; polarity: Polarity }[] = [];
  const onPath = new Set<number>();

  const emit = () => {
    const variableIds = path.map((i) => nodes[i]!);
    const pols = pathLinks.map((p) => p.polarity);
    const kind = pols.some((p) => p !== '+' && p !== '-')
      ? '?'
      : pols.filter((p) => p === '-').length % 2 === 0
        ? 'R'
        : 'B';
    const pts = variableIds.map((v) => pos.get(v)!);
    loops.push({
      key: variableIds.join('|'),
      variableIds,
      linkIds: pathLinks.map((p) => p.link),
      kind,
      direction: signedArea(pts) >= 0 ? 'cw' : 'ccw',
      center: centroid(pts),
    });
  };

  const dfs = (start: number, v: number) => {
    for (const e of adj[v]!) {
      if (loops.length >= maxLoops) {
        truncated = true;
        return;
      }
      if (e.to === start) {
        pathLinks.push(e);
        emit();
        pathLinks.pop();
      } else if (e.to > start && !onPath.has(e.to) && path.length < maxLength) {
        path.push(e.to);
        pathLinks.push(e);
        onPath.add(e.to);
        dfs(start, e.to);
        onPath.delete(e.to);
        pathLinks.pop();
        path.pop();
      }
    }
  };

  for (let s = 0; s < nodes.length && !truncated; s++) {
    path.push(s);
    onPath.add(s);
    dfs(s, s);
    onPath.delete(s);
    path.pop();
  }
  loops.sort((a, b) => a.variableIds.length - b.variableIds.length || (a.key < b.key ? -1 : 1));
  return { loops, truncated };
}

/**
 * A spot near `center` that keeps clear of the diagram's elements (for placing loop markers):
 * the loop centroid when free, otherwise the nearest free point on rings around it.
 */
export function freeSpotNear(diagram: Diagram, center: Point, clearance = 46): Point {
  const obstacles: Point[] = [];
  for (const el of Object.values(diagram.elements)) {
    if (el.type === 'variable' || el.type === 'loop' || el.type === 'text')
      obstacles.push({ x: el.x, y: el.y });
  }
  const free = (p: Point) =>
    obstacles.every((o) => Math.hypot((o.x - p.x) * 0.6, o.y - p.y) >= clearance);
  for (let ring = 0; ring <= 6; ring++) {
    const r = ring * 22;
    const steps = ring === 0 ? 1 : 8 + ring * 4;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const p = {
        x: Math.round(center.x + Math.cos(a) * r),
        y: Math.round(center.y + Math.sin(a) * r),
      };
      if (free(p)) return p;
    }
  }
  return { x: Math.round(center.x), y: Math.round(center.y) };
}

const kindsMatch = (marker: LoopMarker, loop: FoundLoop) =>
  marker.kind === 'custom' || loop.kind === '?' || marker.kind === loop.kind;

/**
 * Which marker belongs to which loop (loop key → marker id); each marker marks at most one loop.
 * Markers that name their loop (`loopKey`) are linked to it. Others (imported from Vensim, or whose
 * loop changed) are paired with the nearest loop of the same type whose area they sit in.
 */
export function matchLoopMarkers(diagram: Diagram, loops: FoundLoop[]): Map<string, string> {
  const markers = Object.values(diagram.elements).filter((e): e is LoopMarker => e.type === 'loop');
  const byKey = new Map(loops.map((l) => [l.key, l]));
  const result = new Map<string, string>();
  const free: LoopMarker[] = [];
  for (const m of markers) {
    if (m.loopKey && byKey.has(m.loopKey) && !result.has(m.loopKey)) result.set(m.loopKey, m.id);
    else free.push(m);
  }
  const pos = new Map<string, Point>();
  for (const el of Object.values(diagram.elements))
    if (el.type === 'variable' && (!pos.has(el.variableId) || !el.isShadow))
      pos.set(el.variableId, { x: el.x, y: el.y });
  const pairs: { loop: string; marker: string; d: number }[] = [];
  for (const loop of loops) {
    if (result.has(loop.key)) continue;
    // How far the loop's variables are from its centre: a marker within that reach sits inside it.
    const reach = Math.max(
      80,
      Math.max(
        ...loop.variableIds.map((v) => {
          const p = pos.get(v);
          return p ? Math.hypot(p.x - loop.center.x, p.y - loop.center.y) : 0;
        }),
      ) * 0.9,
    );
    for (const m of free) {
      const d = Math.hypot(m.x - loop.center.x, m.y - loop.center.y);
      if (d <= reach && kindsMatch(m, loop)) pairs.push({ loop: loop.key, marker: m.id, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const used = new Set<string>();
  for (const p of pairs) {
    if (result.has(p.loop) || used.has(p.marker)) continue;
    result.set(p.loop, p.marker);
    used.add(p.marker);
  }
  return result;
}
