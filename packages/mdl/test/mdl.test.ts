import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import fc from 'fast-check';
import {
  addElement,
  addVariableNode,
  deleteElements,
  emptySnapshot,
  moveElements,
  renameVariable,
  replaceContent,
  setStyle,
  snapshotSchema,
  toSnapshot,
  updateElement,
  type Link,
  type LoopMarker,
  type ProjectSnapshot,
  type VariableNode,
} from '@cld/model';
import { parseMdl, writeMdl } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const FIXTURES = ['coffee-agroforestry.mdl', 'servitization.mdl'];

const all = (s: ProjectSnapshot) => Object.values(s.diagrams).flatMap((d) => Object.values(d.elements));
const toDoc = (s: ProjectSnapshot) => {
  const doc = new Y.Doc();
  replaceContent(doc, s);
  return doc;
};

describe.each(FIXTURES)('%s', (name) => {
  const text = fixture(name);

  it('round-trips byte-for-byte', () => {
    const { snapshot, warnings } = parseMdl(text);
    expect(warnings).toEqual([]);
    expect(writeMdl(snapshot).text).toBe(text);
  });

  it('round-trips through a Yjs document', () => {
    const doc = toDoc(parseMdl(text).snapshot);
    expect(writeMdl(toSnapshot(doc)).text).toBe(text);
  });

  it('produces a valid snapshot', () => {
    const { snapshot } = parseMdl(text);
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});

describe('coffee fixture semantics', () => {
  const { snapshot } = parseMdl(fixture('coffee-agroforestry.mdl'));
  const els = all(snapshot);
  const vars = Object.values(snapshot.variables);

  it('maps variables, links and loop markers', () => {
    expect(vars).toHaveLength(22);
    expect(els.filter((e) => e.type === 'variable')).toHaveLength(22);
    expect(els.filter((e) => e.type === 'link')).toHaveLength(29);
    const loops = els.filter((e): e is LoopMarker => e.type === 'loop');
    expect(loops.map((l) => `${l.label}:${l.direction}`).sort()).toEqual(['B:cw', 'B:cw', 'R:cw', 'R:cw']);
    const node = els.find((e) => e.type === 'variable' && snapshot.variables[e.variableId]!.name === 'Customer trust') as VariableNode;
    expect(node).toMatchObject({ x: 1212, y: 326, w: 148, h: 24 });
  });

  it('reads polarity and curvature', () => {
    const links = els.filter((e): e is Link => e.type === 'link');
    expect(links.filter((l) => l.polarity === '-')).toHaveLength(6);
    expect(links.filter((l) => l.polarity === null)).toHaveLength(1);
    expect(links.filter((l) => l.control === null)).toHaveLength(1);
  });

  it('keeps equation metadata', () => {
    expect(snapshot.meta.vensim?.lineEnding).toBe('\r\n');
    expect(vars.every((v) => v.mdl?.causesKey !== undefined)).toBe(true);
  });
});

describe('servitization fixture semantics', () => {
  const { snapshot } = parseMdl(fixture('servitization.mdl'));
  const els = all(snapshot);

  it('reads counter-clockwise loops, comments and text colors', () => {
    const loops = els.filter((e): e is LoopMarker => e.type === 'loop');
    expect(loops.map((l) => `${l.label}:${l.direction}`).sort()).toEqual(['B:ccw', 'B:cw', 'R:cw', 'R:cw']);
    const texts = els.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(3);
    expect(texts.some((t) => t.type === 'text' && t.text.startsWith('TODO'))).toBe(true);
    const colored = els.filter((e) => e.type === 'variable' && e.style?.textColor);
    expect(colored.map((e) => e.style?.textColor)).toEqual(['#ff007f', '#ff007f']);
  });
});

describe('editing then exporting', () => {
  it('regenerates only what changed and stays parseable', () => {
    const doc = toDoc(parseMdl(fixture('coffee-agroforestry.mdl')).snapshot);
    const snap = toSnapshot(doc);
    const d = Object.values(snap.diagrams)[0]!;
    const layerId = Object.keys(d.layers)[0]!;
    const byName = (n: string) =>
      Object.values(d.elements).find((e) => e.type === 'variable' && snap.variables[e.variableId]!.name === n) as VariableNode;
    const trust = byName('Customer trust');
    const demand = byName('Customer demand for coffee');
    // Move a node, rename a variable, recolor, add a variable + link + loop, delete a node.
    moveElements(doc, d.id, [{ id: trust.id, dx: 10, dy: -5 }]);
    renameVariable(doc, trust.variableId, 'Customer trust (3)');
    setStyle(doc, d.id, [demand.id], { textColor: '#2563eb' });
    const n = addVariableNode(doc, d.id, { name: 'Marketing spend', x: 1500, y: 200, layerId });
    addElement(doc, d.id, { type: 'link', layerId, from: n, to: trust.id, control: { x: 1400, y: 230 }, polarity: '+' });
    addElement(doc, d.id, { type: 'loop', layerId, x: 900, y: 900, r: 28, kind: 'B', label: 'B9', direction: 'ccw' });
    deleteElements(doc, d.id, [byName('Equipment costs per farmer').id]);

    const out = writeMdl(toSnapshot(doc)).text.replace(/\r\n/g, '\n');
    expect(out).toContain('"Customer trust (3)"  = A FUNCTION OF( "Agroforestry digital traceability (6)",Marketing spend)');
    expect(out).toContain('Marketing spend  = A FUNCTION OF( )');
    expect(out).not.toContain('Equipment costs per farmer');
    expect(out).toContain(',|||37-99-235,');
    expect(out).toMatch(/\n12,\d+,0,900,900,28,28,5,7,[^\n]*\nB9\n/);

    // The export re-imports to the same model.
    const again = parseMdl(out);
    expect(again.warnings).toEqual([]);
    const s2 = again.snapshot;
    const els2 = all(s2);
    expect(Object.values(s2.variables)).toHaveLength(22); // 22 - 1 deleted + 1 new
    expect(els2.filter((e) => e.type === 'link')).toHaveLength(29); // 29 - 1 deleted + 1 new
    const t2 = els2.find((e) => e.type === 'variable' && s2.variables[e.variableId]!.name === 'Customer trust (3)') as VariableNode;
    expect(t2).toMatchObject({ x: 1222, y: 321 });
    // Ids are consecutive and links reference earlier objects.
    const sketchLines = out.split('*View 1\n')[1]!.split('///---')[0]!.trim().split('\n').filter((l) => /^\d+,\d+,/.test(l));
    sketchLines.forEach((l, k) => expect(l.split(',')[1]).toBe(String(k + 1)));
    for (const l of sketchLines.filter((x) => x.startsWith('1,'))) {
      const [, id, from, to] = l.split(',').map(Number);
      expect(from).toBeLessThan(id!);
      expect(to).toBeLessThan(id!);
    }
    // Writing the re-import again is stable.
    expect(writeMdl(s2).text.replace(/\r\n/g, '\n')).toBe(out);
  });

  it('exports a diagram that never came from Vensim', () => {
    const doc = toDoc(emptySnapshot());
    const s = toSnapshot(doc);
    const d = Object.values(s.diagrams)[0]!;
    const layerId = Object.keys(d.layers)[0]!;
    const a = addVariableNode(doc, d.id, { name: 'Births', x: 100, y: 100, layerId });
    const b = addVariableNode(doc, d.id, { name: 'Population, total', x: 300, y: 100, layerId });
    addElement(doc, d.id, { type: 'link', layerId, from: a, to: b, control: null, polarity: '+' });
    const l = addElement(doc, d.id, { type: 'link', layerId, from: b, to: a, control: { x: 200, y: 160 }, polarity: '+' });
    updateElement(doc, d.id, l, { polarity: '-' });
    addElement(doc, d.id, { type: 'text', layerId, x: 200, y: 300, w: 160, h: 40, text: 'Note' });
    const out = writeMdl(toSnapshot(doc));
    expect(out.text.startsWith('{UTF-8}\n')).toBe(true);
    expect(out.text).toContain('"Population, total"  = A FUNCTION OF( Births)');
    expect(out.text).toContain('Births  = A FUNCTION OF( "Population, total")');
    expect(out.text).toContain('*Main\n');
    const back = parseMdl(out.text);
    expect(back.warnings).toEqual([]);
    const links = all(back.snapshot).filter((e): e is Link => e.type === 'link');
    expect(links.map((x) => x.polarity).sort()).toEqual(['+', '-']);
    expect(links.find((x) => x.polarity === '-')!.control).toEqual({ x: 200, y: 160 });
  });

  it('never throws on corrupted input', () => {
    const text = fixture('servitization.mdl');
    fc.assert(
      fc.property(fc.nat(text.length), fc.nat(text.length), fc.string(), (a, b, junk) => {
        const corrupted = text.slice(0, Math.min(a, b)) + junk + text.slice(Math.max(a, b));
        const { snapshot } = parseMdl(corrupted);
        expect(Object.keys(snapshot.diagrams).length).toBeGreaterThan(0);
        writeMdl(snapshot);
      }),
      { numRuns: 300 },
    );
  });
});
