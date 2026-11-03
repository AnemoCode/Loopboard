import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMdl } from '@cld/mdl';
import {
  arcThrough,
  controlFromBend,
  emptySnapshot,
  type DiagramElement,
  type ProjectSnapshot,
} from '@cld/model';
import {
  darkTheme,
  insideBoundary,
  layoutDiagram,
  measureText,
  renderDiagramSvg,
  wrapText,
} from '../src/index.js';

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

  it('knows what lies inside a hexagon (pointed left and right)', () => {
    const hex = { kind: 'hexagon' as const, cx: 0, cy: 0, hw: 40, hh: 20 };
    expect(insideBoundary(hex, { x: 0, y: 0 })).toBe(true);
    expect(insideBoundary(hex, { x: 39, y: 0 })).toBe(true); // near the left/right points
    expect(insideBoundary(hex, { x: 19, y: 19 })).toBe(true); // flat top
    expect(insideBoundary(hex, { x: 38, y: 18 })).toBe(false); // cut-off corner of the box
    expect(insideBoundary(hex, { x: 0, y: 21 })).toBe(false);
  });
});

describe.each(['coffee-agroforestry.mdl', 'servitization.mdl', 'vensim-styles.mdl'])(
  'rendering %s',
  (name) => {
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
        // Ends sit on (just outside) the node's outline: box, circle, diamond or hexagon.
        expect(insideBoundary(layout.byId.get(el.from)!.boundary!, l.start, -1)).toBe(false);
        expect(insideBoundary(layout.byId.get(el.to)!.boundary!, l.end, -1)).toBe(false);
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
  },
);

describe('polarity signs', () => {
  const signsOf = (snap: ProjectSnapshot) => {
    const d = snap.diagrams[first(snap)]!;
    const layout = layoutDiagram(
      { elements: d.elements, layers: d.layers, variableName: (id) => snap.variables[id]!.name },
      darkTheme,
    );
    return Object.values(d.elements).flatMap((el) => {
      const p = el.type === 'link' ? layout.byId.get(el.id)?.link?.polarity : undefined;
      return p ? [{ id: el.id, ...p }] : [];
    });
  };
  const closest = (signs: ReturnType<typeof signsOf>) => {
    let min = Infinity;
    for (const a of signs)
      for (const b of signs)
        if (a !== b && (a.auto || b.auto))
          min = Math.min(min, Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y));
    return min;
  };

  /** Two loops meeting at one variable, like "Word of Mouth": both arcs arrive from above. */
  function figureEight(pinned?: 'outside') {
    const snap = emptySnapshot();
    const d = snap.diagrams[first(snap)]!;
    const layerId = Object.keys(d.layers)[0]!;
    const pos = { s: { x: 160, y: 300 }, b: { x: 440, y: 300 }, l: { x: 720, y: 300 } };
    const names = { s: 'Sales', b: 'Customer Base', l: 'Loss' };
    const add = (el: DiagramElement) => (d.elements[el.id] = el);
    for (const k of ['s', 'b', 'l'] as const) {
      snap.variables[`v${k}`] = { id: `v${k}`, name: names[k] };
      add({
        id: k,
        type: 'variable',
        layerId,
        z: 'a0',
        variableId: `v${k}`,
        ...pos[k],
        w: 110,
        h: 30,
        form: 'none',
      });
    }
    const link = (f: keyof typeof pos, t: keyof typeof pos, polarity: '+' | '-', s: number) =>
      add({
        id: `${f}${t}`,
        type: 'link',
        layerId,
        z: 'a1',
        from: f,
        to: t,
        polarity,
        control: controlFromBend(pos[f], pos[t], { t: 0.5, s }),
        ...(pinned ? { style: { polaritySide: pinned } } : {}),
      });
    link('s', 'b', '+', -0.4);
    link('b', 's', '+', -0.4);
    link('l', 'b', '-', 0.4);
    link('b', 'l', '+', 0.4);
    return snap;
  }

  it('keeps signs of links arriving at the same variable apart', () => {
    const signs = signsOf(figureEight());
    expect(signs).toHaveLength(4);
    expect(closest(signs)).toBeGreaterThanOrEqual(18);
  });

  it('leaves signs alone whose side was chosen explicitly', () => {
    const signs = signsOf(figureEight('outside'));
    expect(signs.every((s) => !s.auto)).toBe(true);
    const a = signs.find((x) => x.id === 'sb')!;
    const c = signs.find((x) => x.id === 'lb')!;
    // Both pinned outside: they still meet above "Customer Base" (that's what the user chose).
    expect(Math.hypot(a.at.x - c.at.x, a.at.y - c.at.y)).toBeLessThan(18);
  });

  it.each(['coffee-agroforestry.mdl', 'servitization.mdl'])(
    'has no overlapping signs in %s',
    (name) => {
      expect(closest(signsOf(load(name)))).toBeGreaterThanOrEqual(18);
    },
  );
});
