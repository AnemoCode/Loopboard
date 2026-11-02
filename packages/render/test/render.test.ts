import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMdl } from '@cld/mdl';
import { arcThrough, type ProjectSnapshot } from '@cld/model';
import { darkTheme, layoutDiagram, measureText, renderDiagramSvg, wrapText } from '../src/index.js';

const load = (name: string) =>
  parseMdl(readFileSync(new URL(`../../mdl/test/fixtures/${name}`, import.meta.url), 'utf8'))
    .snapshot;
const first = (s: ProjectSnapshot) => Object.keys(s.diagrams)[0]!;

describe('text', () => {
  it('measures with Helvetica metrics and wraps', () => {
    const font = { family: 'sans' as const, size: 10, bold: false, italic: false };
    expect(measureText('Hello', font)).toBeCloseTo(22.8, 0);
    expect(wrapText('Investment in sharing equipment between farmers', font, 100)).toEqual([
      'Investment in sharing',
      'equipment between',
      'farmers',
    ]);
    expect(wrapText('a\nb', font, 100)).toEqual(['a', 'b']);
    expect(wrapText('Supercalifragilistic', font, 30).length).toBeGreaterThan(1);
  });
});

describe('geometry', () => {
  it('builds arcs through three points', () => {
    const arc = arcThrough({ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 })!;
    expect(arc.cx).toBeCloseTo(50);
    expect(arc.cy).toBeCloseTo(0);
    expect(arc.r).toBeCloseTo(50);
    expect(arcThrough({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 })).toBeNull();
  });
});

describe.each(['coffee-agroforestry.mdl', 'servitization.mdl'])('rendering %s', (name) => {
  const snap = load(name);

  it('lays out every element and clips links outside their nodes', () => {
    const d = snap.diagrams[first(snap)]!;
    const layout = layoutDiagram(
      { elements: d.elements, layers: d.layers, variableName: (id) => snap.variables[id]!.name },
      darkTheme,
    );
    expect(layout.order.length).toBe(Object.keys(d.elements).length);
    for (const el of Object.values(d.elements)) {
      if (el.type !== 'link') continue;
      const l = layout.byId.get(el.id)!.link!;
      const fromBox = layout.byId.get(el.from)!.bbox;
      const inside = (p: { x: number; y: number }, b: typeof fromBox) =>
        p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
      expect(inside(l.start, fromBox)).toBe(false);
      expect(inside(l.end, layout.byId.get(el.to)!.bbox)).toBe(false);
    }
  });

  it('renders deterministic SVG', () => {
    const a = renderDiagramSvg(snap, first(snap));
    const b = renderDiagramSvg(snap, first(snap));
    expect(a.svg).toBe(b.svg);
    expect(a.svg).toContain('<svg');
    expect(a.width).toBeGreaterThan(500);
    mkdirSync(new URL('./__output__/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`./__output__/${name}.svg`, import.meta.url), a.svg);
  });

  it('puts the polarity sign on the inner side of a curve when asked', () => {
    const d = snap.diagrams[first(snap)]!;
    const glyphAt = (side: 'outside' | 'inside') => {
      const elements = structuredClone(d.elements);
      for (const e of Object.values(elements))
        if (e.type === 'link') e.style = { ...e.style, polaritySide: side };
      const layout = layoutDiagram(
        { elements, layers: d.layers, variableName: (id) => snap.variables[id]!.name },
        darkTheme,
      );
      return (id: string) => {
        const t = layout.byId.get(id)!.prims.find((p) => p.t === 'text');
        return t?.t === 'text' ? { x: t.x, y: t.lines[0]!.y } : null;
      };
    };
    const outside = glyphAt('outside');
    const inside = glyphAt('inside');
    const pos = (id: string) => d.elements[id] as { x: number; y: number };
    let curved = 0;
    for (const l of Object.values(d.elements)) {
      if (l.type !== 'link' || !l.polarity || !l.control || l.from === l.to) continue;
      const arc = arcThrough(pos(l.from), l.control, pos(l.to));
      if (!arc) continue;
      const o = outside(l.id)!;
      const i = inside(l.id)!;
      // Mirrored across the line, and the inner one is nearer the arc's centre.
      expect(Math.hypot(o.x - i.x, o.y - i.y)).toBeCloseTo(20, 0);
      expect(Math.hypot(i.x - arc.cx, i.y - arc.cy)).toBeLessThan(
        Math.hypot(o.x - arc.cx, o.y - arc.cy),
      );
      curved++;
    }
    expect(curved).toBeGreaterThan(0);
  });

  it('escapes user text', () => {
    const s = structuredClone(snap);
    const v = Object.values(s.variables)[0]!;
    v.name = '<script>alert(1)</script> & "x"';
    const { svg } = renderDiagramSvg(s, first(s));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
