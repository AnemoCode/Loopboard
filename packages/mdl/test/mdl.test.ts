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
  type ShapeElement,
  type VariableNode,
} from '@cld/model';
import { parseMdl, writeMdl } from '../src/index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const FIXTURES = ['coffee-agroforestry.mdl', 'servitization.mdl', 'vensim-styles.mdl'];

const all = (s: ProjectSnapshot) =>
  Object.values(s.diagrams).flatMap((d) => Object.values(d.elements));
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
    expect(loops.map((l) => `${l.label}:${l.direction}`).sort()).toEqual([
      'B:cw',
      'B:cw',
      'R:cw',
      'R:cw',
    ]);
    const node = els.find(
      (e) => e.type === 'variable' && snapshot.variables[e.variableId]!.name === 'Customer trust',
    ) as VariableNode;
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
    expect(loops.map((l) => `${l.label}:${l.direction}`).sort()).toEqual([
      'B:ccw',
      'B:cw',
      'R:cw',
      'R:cw',
    ]);
    const texts = els.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(3);
    expect(texts.some((t) => t.type === 'text' && t.text.startsWith('TODO'))).toBe(true);
    const colored = els.filter((e) => e.type === 'variable' && e.style?.textColor);
    expect(colored.map((e) => e.style?.textColor)).toEqual(['#ff007f', '#ff007f']);
  });
});

describe('vensim-styles fixture: shapes, colors, fonts, polarity placement', () => {
  const text = fixture('vensim-styles.mdl');
  const { snapshot } = parseMdl(text);
  const d = Object.values(snapshot.diagrams)[0]!;
  const node = (n: string) =>
    Object.values(d.elements).find(
      (e) => e.type === 'variable' && snapshot.variables[e.variableId]!.name === n,
    ) as VariableNode;
  const sketchLine = (out: string, name: string) =>
    out.split(/\r?\n/).find((l) => l.startsWith('10,') && l.includes(name))!;

  it('reads shapes (box, circle, diamond) with their Vensim sizes', () => {
    expect(node('Investment in digitalization')).toMatchObject({ form: 'rect', w: 108, h: 52 });
    expect(node('Revenue for Grow Grounds').form).toBe('rect');
    expect(node('Agroforestry digital traceability (6)')).toMatchObject({
      form: 'ellipse',
      w: 142,
      h: 142,
    });
    expect(node('Customer trust')).toMatchObject({ form: 'diamond', w: 148, h: 148 });
    expect(node('Brand reputation').form).toBe('none');
  });

  it('reads outline and fill colors, text colors and font attributes', () => {
    expect(node('Investment in digitalization').style).toEqual({
      stroke: '#ff77ff',
      fill: '#ff77ff',
    });
    expect(node('Customer demand for coffee').style).toEqual({ textColor: '#ff007f', bold: true });
    expect(node('Long-term net GHG impact').style).toEqual({ underline: true });
    expect(node('Coffee ouput').style).toEqual({ italic: true });
    expect(node('Carbon revenue').style).toEqual({ strike: true });
    // Skia is a sans-serif face and the color is Vensim's default black: nothing to restyle.
    expect(node('Revenue for farmers').style).toBeUndefined();
  });

  it('puts polarity signs inside the curve where Vensim does', () => {
    const links = Object.values(d.elements).filter((e): e is Link => e.type === 'link');
    const inside = links.filter((l) => l.style?.polaritySide === 'inside');
    const names = (l: Link) =>
      [l.from, l.to].map((id) => {
        const el = d.elements[id] as VariableNode;
        return snapshot.variables[el.variableId]!.name;
      });
    expect(inside.map(names).sort()).toEqual([
      ['Brand reputation', 'Financial support from supply-chain partners (7)'],
      ['Financial support from supply-chain partners (7)', 'Supply-chain stability'],
    ]);
  });

  it('exports edited looks in the fields Vensim reads', () => {
    const doc = toDoc(snapshot);
    const s = toSnapshot(doc);
    const id = (n: string) =>
      Object.values(s.diagrams[d.id]!.elements).find(
        (e) => e.type === 'variable' && s.variables[e.variableId]!.name === n,
      )!.id;
    updateElement(doc, d.id, id('Brand reputation'), { form: 'diamond' });
    setStyle(doc, d.id, [id('Brand reputation')], { fill: '#00ff00', textColor: '#0000ff' });
    setStyle(doc, d.id, [id('Customer demand for coffee')], { bold: false, italic: true });
    updateElement(doc, d.id, id('Customer trust'), { form: 'ellipse' });
    setStyle(doc, d.id, [id('Partner trust')], { fontFamily: 'serif', fontSize: 16 });
    const link = Object.values(s.diagrams[d.id]!.elements).find(
      (e): e is Link => e.type === 'link' && e.style?.polaritySide === 'inside',
    )!;
    setStyle(doc, d.id, [link.id], { polaritySide: 'outside', color: '#ff0000' });

    const { text: out, warnings } = writeMdl(toSnapshot(doc));
    expect(warnings).toEqual([]);
    // sh 11 = diamond; hasf 2 + 4 = word + fill color; never hidden (hid stays 0).
    expect(sketchLine(out, 'Brand reputation')).toMatch(
      /^10,\d+,Brand reputation,471,286,46,19,11,3,0,6,-1,0,0,0,0-0-0,0-255-0,\|\|\|0-0-255,0,0,0,0,0,0$/,
    );
    expect(sketchLine(out, 'Customer demand for coffee')).toContain(',8,3,0,18,');
    expect(sketchLine(out, 'Customer demand for coffee')).toContain('||I|255-0-127,');
    expect(sketchLine(out, 'Customer trust')).toContain(',74,74,2,3,0,0,');
    expect(sketchLine(out, 'Partner trust')).toContain(
      ',8,3,0,40,-1,0,0,0,0-0-0,0-0-0,Times New Roman|16||0-0-0,',
    );
    const arrow = out.split(/\r?\n/).find((l) => l.startsWith('1,') && l.includes(',255-0-0,'))!;
    // hasf 1 = arrow color applies; dtype bit 128 = polarity outside.
    expect(arrow.split(',').slice(8, 12)).toEqual(['1', String(64 | 128), '0', '255-0-0']);

    // Everything else is untouched, and the export reads back with the same looks.
    const back = parseMdl(out).snapshot;
    const b = Object.values(back.diagrams)[0]!;
    const look = (n: string) =>
      Object.values(b.elements).find(
        (e) => e.type === 'variable' && back.variables[e.variableId]!.name === n,
      ) as VariableNode;
    expect(look('Brand reputation')).toMatchObject({
      form: 'diamond',
      style: { fill: '#00ff00', textColor: '#0000ff' },
    });
    expect(look('Customer trust').form).toBe('ellipse');
    expect(look('Investment in digitalization').style).toEqual({
      stroke: '#ff77ff',
      fill: '#ff77ff',
    });
    expect(look('Partner trust').style).toEqual({ fontFamily: 'serif', fontSize: 16 });
    expect(writeMdl(back).text).toBe(out);
  });

  it('keeps the variable visible when only a text color is set (regression)', () => {
    const doc = toDoc(parseMdl(fixture('coffee-agroforestry.mdl')).snapshot);
    const s = toSnapshot(doc);
    const dd = Object.values(s.diagrams)[0]!;
    const v = Object.values(dd.elements).find((e) => e.type === 'variable')!;
    setStyle(doc, dd.id, [v.id], { textColor: '#2563eb' });
    const line = writeMdl(toSnapshot(doc))
      .text.split(/\r?\n/)
      .find((l) => l.includes('|||37-99-235'))!;
    const f = line.split(',');
    const at = f.findIndex((x) => x.startsWith('"') && !x.endsWith('"')) >= 0 ? 1 : 0;
    expect(f.slice(7 + at, 11 + at)).toEqual(['8', '3', '0', '2']); // sh, bits, hid=0, hasf=2
  });
});

describe('hexagons and comment shapes', () => {
  // The styled fixture with a hexagon variable and one comment of each shape added (as Vensim writes them).
  const text = fixture('vensim-styles.mdl')
    .replace('10,8,Brand reputation,471,286,46,19,8,', '10,8,Brand reputation,471,286,46,46,6,')
    .replace(
      '///---\\\\\\\n',
      [
        '12,56,0,900,100,80,30,3,7,0,4,-1,0,0,0,0-0-0,255-255-128,|||0-0-0,0,0,0,0,0,0',
        'Boxed note',
        '12,57,0,900,200,40,40,2,7,0,0,-1,0,0,0,0,0,0,0,0,0',
        'Round note',
        '12,58,0,900,300,52,52,6,7,0,2,-1,0,0,0,0-0-0,0-0-0,|||255-0-0,0,0,0,0,0,0',
        'Sector',
        '12,59,0,900,400,40,40,11,3,0,0,-1,0,0,0,0,0,0,0,0,0',
        '12,60,0,900,500,80,20,8,7,0,0,-1,0,0,0,0,0,0,0,0,0',
        'Plain note',
        '///---\\\\\\\n',
      ].join('\n'),
    );
  const { snapshot, warnings } = parseMdl(text);
  const els = all(snapshot);
  const shape = (t: string) =>
    els.find((e) => e.type === 'shape' && e.text === t) as ShapeElement | undefined;

  it('reads hexagon variables and boxed, round, hexagon and diamond comments', () => {
    expect(warnings).toEqual([]);
    const brand = els.find(
      (e) => e.type === 'variable' && snapshot.variables[e.variableId]!.name === 'Brand reputation',
    ) as VariableNode;
    expect(brand.form).toBe('hexagon');
    expect(shape('Boxed note')).toMatchObject({
      shape: 'rect',
      w: 160,
      h: 60,
      style: { fill: '#ffff80' },
    });
    expect(shape('Round note')).toMatchObject({ shape: 'ellipse', style: { fill: null } });
    expect(shape('Sector')).toMatchObject({ shape: 'hexagon', style: { textColor: '#ff0000' } });
    expect(els.find((e) => e.type === 'shape' && e.shape === 'diamond')).toMatchObject({ w: 80 });
    expect(els.find((e) => e.type === 'text' && e.text === 'Plain note')).toBeTruthy();
  });

  it('round-trips byte-for-byte and exports edited shapes', () => {
    expect(writeMdl(snapshot).text).toBe(text);
    const doc = toDoc(snapshot);
    const s = toSnapshot(doc);
    const d = Object.values(s.diagrams)[0]!;
    const boxed = Object.values(d.elements).find(
      (e) => e.type === 'shape' && e.text === 'Boxed note',
    )!;
    updateElement(doc, d.id, boxed.id, { shape: 'hexagon' });
    setStyle(doc, d.id, [boxed.id], { fill: '#00ff00' });
    const out = writeMdl(toSnapshot(doc));
    expect(out.warnings).toEqual([]);
    expect(out.text).toMatch(
      /\n12,\d+,0,900,100,80,30,6,7,0,4,-1,0,0,0,0-0-0,0-255-0,\|\|\|0-0-0,0,0,0,0,0,0\nBoxed note\n/,
    );
    const back = all(parseMdl(out.text).snapshot).find(
      (e) => e.type === 'shape' && e.text === 'Boxed note',
    );
    expect(back).toMatchObject({ shape: 'hexagon', style: { fill: '#00ff00' } });
  });
});

describe('editing then exporting', () => {
  it('regenerates only what changed and stays parseable', () => {
    const doc = toDoc(parseMdl(fixture('coffee-agroforestry.mdl')).snapshot);
    const snap = toSnapshot(doc);
    const d = Object.values(snap.diagrams)[0]!;
    const layerId = Object.keys(d.layers)[0]!;
    const byName = (n: string) =>
      Object.values(d.elements).find(
        (e) => e.type === 'variable' && snap.variables[e.variableId]!.name === n,
      ) as VariableNode;
    const trust = byName('Customer trust');
    const demand = byName('Customer demand for coffee');
    // Move a node, rename a variable, recolor, add a variable + link + loop, delete a node.
    moveElements(doc, d.id, [{ id: trust.id, dx: 10, dy: -5 }]);
    renameVariable(doc, trust.variableId, 'Customer trust (3)');
    setStyle(doc, d.id, [demand.id], { textColor: '#2563eb' });
    const n = addVariableNode(doc, d.id, { name: 'Marketing spend', x: 1500, y: 200, layerId });
    addElement(doc, d.id, {
      type: 'link',
      layerId,
      from: n,
      to: trust.id,
      control: { x: 1400, y: 230 },
      polarity: '+',
    });
    addElement(doc, d.id, {
      type: 'loop',
      layerId,
      x: 900,
      y: 900,
      r: 28,
      kind: 'B',
      label: 'B9',
      direction: 'ccw',
    });
    deleteElements(doc, d.id, [byName('Equipment costs per farmer').id]);

    const out = writeMdl(toSnapshot(doc)).text.replace(/\r\n/g, '\n');
    expect(out).toContain(
      '"Customer trust (3)"  = A FUNCTION OF( "Agroforestry digital traceability (6)",Marketing spend)',
    );
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
    const t2 = els2.find(
      (e) => e.type === 'variable' && s2.variables[e.variableId]!.name === 'Customer trust (3)',
    ) as VariableNode;
    expect(t2).toMatchObject({ x: 1222, y: 321 });
    // Ids are consecutive and links reference earlier objects.
    const sketchLines = out
      .split('*View 1\n')[1]!
      .split('///---')[0]!
      .trim()
      .split('\n')
      .filter((l) => /^\d+,\d+,/.test(l));
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
    const l = addElement(doc, d.id, {
      type: 'link',
      layerId,
      from: b,
      to: a,
      control: { x: 200, y: 160 },
      polarity: '+',
    });
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
