import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import fc from 'fast-check';
import {
  addDiagram,
  addElement,
  addLayer,
  addVariableNode,
  appendSnapshot,
  copyElements,
  deleteDiagram,
  deleteElements,
  deleteLayer,
  duplicateDiagram,
  findLoops,
  matchLoopMarkers,
  initDoc,
  moveElements,
  pasteElements,
  renameVariable,
  reorderElements,
  repairDoc,
  roots,
  setStyle,
  snapshotSchema,
  toSnapshot,
  type Link,
} from '../src/index.js';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const snap = toSnapshot(doc);
  const diagram = Object.values(snap.diagrams)[0]!;
  const layerId = Object.keys(diagram.layers)[0]!;
  return { doc, diagramId: diagram.id, layerId };
}

const els = (doc: Y.Doc, diagramId: string) => toSnapshot(doc).diagrams[diagramId]!.elements;

function link(
  doc: Y.Doc,
  diagramId: string,
  layerId: string,
  from: string,
  to: string,
  polarity: Link['polarity'] = '+',
) {
  return addElement(doc, diagramId, { type: 'link', layerId, from, to, control: null, polarity });
}

describe('variables', () => {
  it('creates a variable per node and reuses names as shadows', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'Births', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: '  births ', x: 50, y: 0, layerId });
    const e = els(doc, diagramId);
    expect(Object.keys(toSnapshot(doc).variables)).toHaveLength(1);
    expect(e[a]).toMatchObject({ type: 'variable' });
    expect((e[b] as { isShadow?: boolean }).isShadow).toBe(true);
  });

  it('rejects duplicate and empty renames', () => {
    const { doc, diagramId, layerId } = setup();
    addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const n = addVariableNode(doc, diagramId, { name: 'B', x: 0, y: 0, layerId });
    const vid = (els(doc, diagramId)[n] as { variableId: string }).variableId;
    expect(renameVariable(doc, vid, 'a')).toEqual({ ok: false, reason: 'duplicate' });
    expect(renameVariable(doc, vid, '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(renameVariable(doc, vid, 'Deaths  per year')).toEqual({ ok: true });
    expect(toSnapshot(doc).variables[vid]!.name).toBe('Deaths per year');
  });
});

describe('deleting', () => {
  it('cascades to links, garbage-collects variables and promotes shadows', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 0, layerId });
    const a2 = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 100, layerId });
    link(doc, diagramId, layerId, a, b);
    expect(deleteElements(doc, diagramId, [a])).toBe(2);
    const e = els(doc, diagramId);
    expect(Object.keys(e).sort()).toEqual([a2, b].sort());
    expect((e[a2] as { isShadow?: boolean }).isShadow).toBeUndefined();
    deleteElements(doc, diagramId, [a2]);
    expect(Object.values(toSnapshot(doc).variables).map((v) => v.name)).toEqual(['B']);
  });

  it('keeps at least one diagram and one layer', () => {
    const { doc, diagramId, layerId } = setup();
    expect(deleteDiagram(doc, diagramId)).toBe(false);
    expect(deleteLayer(doc, diagramId, layerId, null)).toBe(false);
    const second = addDiagram(doc, 'Second');
    expect(deleteDiagram(doc, second)).toBe(true);
  });

  it('moves elements to another layer when deleting a layer', () => {
    const { doc, diagramId, layerId } = setup();
    const l2 = addLayer(doc, diagramId, 'Notes');
    const t = addElement(doc, diagramId, {
      type: 'text',
      layerId: l2,
      x: 0,
      y: 0,
      w: 100,
      h: 20,
      text: 'hi',
    });
    deleteLayer(doc, diagramId, l2, layerId);
    expect(els(doc, diagramId)[t]!.layerId).toBe(layerId);
  });
});

describe('moving', () => {
  it('keeps the relative bend of curved links when one endpoint moves', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 0, layerId });
    const l = addElement(doc, diagramId, {
      type: 'link',
      layerId,
      from: a,
      to: b,
      control: { x: 50, y: 20 },
      polarity: '+',
    });
    moveElements(doc, diagramId, [{ id: b, dx: 100, dy: 0 }]);
    expect((els(doc, diagramId)[l] as Link).control).toEqual({ x: 100, y: 40 });
    moveElements(doc, diagramId, [
      { id: a, dx: 10, dy: 10 },
      { id: b, dx: 10, dy: 10 },
    ]);
    expect((els(doc, diagramId)[l] as Link).control).toEqual({ x: 110, y: 50 });
  });
});

describe('ordering, style, copy/paste, diagrams', () => {
  it('reorders z within a layer', () => {
    const { doc, diagramId, layerId } = setup();
    const ids = [0, 1, 2].map((i) =>
      addElement(doc, diagramId, { type: 'text', layerId, x: i, y: 0, w: 10, h: 10, text: `${i}` }),
    );
    const order = () =>
      Object.values(els(doc, diagramId))
        .sort((x, y) => (x.z < y.z ? -1 : 1))
        .map((e) => e.id);
    reorderElements(doc, diagramId, [ids[0]!], 'front');
    expect(order()).toEqual([ids[1], ids[2], ids[0]]);
    reorderElements(doc, diagramId, [ids[0]!], 'backward');
    expect(order()).toEqual([ids[1], ids[0], ids[2]]);
    reorderElements(doc, diagramId, [ids[2]!], 'back');
    expect(order()).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('sets and resets style props', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    setStyle(doc, diagramId, [a], { textColor: '#ff0000', bold: true });
    setStyle(doc, diagramId, [a], { bold: undefined });
    expect(els(doc, diagramId)[a]!.style).toEqual({ textColor: '#ff0000' });
  });

  it('copies and pastes elements with internal links', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 0, layerId });
    link(doc, diagramId, layerId, a, b, '-');
    const copied = copyElements(doc, diagramId, [a, b]);
    expect(copied).toHaveLength(3);
    const created = pasteElements(doc, diagramId, copied, layerId, 20, 20);
    expect(created).toHaveLength(3);
    const e = els(doc, diagramId);
    const newLink = Object.values(e)
      .filter((x) => x.type === 'link')
      .find((x) => created.includes(x.id)) as Link;
    expect(created).toContain(newLink.from);
    expect(newLink.polarity).toBe('-');
  });

  it('duplicates a diagram as shadows and appends snapshots', () => {
    const { doc, diagramId, layerId } = setup();
    addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const copy = duplicateDiagram(doc, diagramId)!;
    const node = Object.values(els(doc, copy))[0] as { isShadow?: boolean };
    expect(node.isShadow).toBe(true);
    const other = new Y.Doc();
    initDoc(other);
    const od = Object.keys(toSnapshot(other).diagrams)[0]!;
    const ol = Object.keys(toSnapshot(other).diagrams[od]!.layers)[0]!;
    addVariableNode(other, od, { name: 'a', x: 0, y: 0, layerId: ol });
    addVariableNode(other, od, { name: 'New', x: 0, y: 0, layerId: ol });
    const created = appendSnapshot(doc, toSnapshot(other));
    expect(created).toHaveLength(1);
    expect(
      Object.values(toSnapshot(doc).variables)
        .map((v) => v.name)
        .sort(),
    ).toEqual(['A', 'New']);
    expect(snapshotSchema.safeParse(toSnapshot(doc)).success).toBe(true);
  });
});

describe('loop analysis', () => {
  it('finds and classifies loops with direction', () => {
    const { doc, diagramId, layerId } = setup();
    // Triangle drawn clockwise on screen: top -> right -> bottom-left.
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 100, layerId });
    const c = addVariableNode(doc, diagramId, { name: 'C', x: -100, y: 100, layerId });
    link(doc, diagramId, layerId, a, b, '+');
    link(doc, diagramId, layerId, b, c, '-');
    link(doc, diagramId, layerId, c, a, '+');
    link(doc, diagramId, layerId, a, c, '+');
    const { loops } = findLoops(toSnapshot(doc).diagrams[diagramId]!);
    expect(loops).toHaveLength(2);
    expect(loops[0]).toMatchObject({ kind: 'R' }); // A <-> C, 2 links
    const tri = loops.find((l) => l.variableIds.length === 3)!;
    expect(tri.kind).toBe('B');
    expect(tri.direction).toBe('cw');
  });

  it('links markers to their loops by key, falling back to the nearest matching loop', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 100, layerId });
    const c = addVariableNode(doc, diagramId, { name: 'C', x: -100, y: 100, layerId });
    link(doc, diagramId, layerId, a, b, '+');
    link(doc, diagramId, layerId, b, c, '-');
    link(doc, diagramId, layerId, c, a, '+');
    link(doc, diagramId, layerId, a, c, '+');
    const loops = findLoops(toSnapshot(doc).diagrams[diagramId]!).loops;
    const tri = loops.find((l) => l.variableIds.length === 3)!;
    const pair = loops.find((l) => l.variableIds.length === 2)!;
    const marker = (extra: object) =>
      addElement(doc, diagramId, {
        type: 'loop',
        layerId,
        x: 0,
        y: 60,
        r: 26,
        kind: 'B',
        label: 'B1',
        direction: 'cw',
        ...extra,
      });

    // Far from the triangle's centre, but it names its loop.
    const keyed = marker({ x: 400, y: 400, loopKey: tri.key });
    let m = matchLoopMarkers(toSnapshot(doc).diagrams[diagramId]!, loops);
    expect(m.get(tri.key)).toBe(keyed);
    expect(m.has(pair.key)).toBe(false);

    // A marker without a key goes to the nearest loop of its type it sits in, one loop per marker.
    deleteElements(doc, diagramId, [keyed]);
    const near = marker({ kind: 'R', label: 'R1', x: -50, y: 50 });
    const far = marker({ kind: 'R', label: 'R2', x: 2000, y: 2000 });
    m = matchLoopMarkers(toSnapshot(doc).diagrams[diagramId]!, loops);
    expect(m.get(pair.key)).toBe(near);
    expect(m.has(tri.key)).toBe(false); // the R markers can't mark a balancing loop
    expect([...m.values()]).not.toContain(far);
  });
});

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );

describe('concurrency', () => {
  type Op =
    | { k: 'add'; name: string; x: number }
    | { k: 'link'; i: number; j: number }
    | { k: 'del'; i: number }
    | { k: 'move'; i: number; d: number }
    | { k: 'layer' };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      k: fc.constant('add' as const),
      name: fc.constantFrom('A', 'B', 'C', 'D'),
      x: fc.integer({ min: 0, max: 500 }),
    }),
    fc.record({ k: fc.constant('link' as const), i: fc.nat(20), j: fc.nat(20) }),
    fc.record({ k: fc.constant('del' as const), i: fc.nat(20) }),
    fc.record({
      k: fc.constant('move' as const),
      i: fc.nat(20),
      d: fc.integer({ min: -50, max: 50 }),
    }),
    fc.record({ k: fc.constant('layer' as const) }),
  );

  function apply(doc: Y.Doc, diagramId: string, op: Op) {
    const s = toSnapshot(doc).diagrams[diagramId]!;
    const nodes = Object.values(s.elements)
      .filter((e) => e.type === 'variable')
      .map((e) => e.id)
      .sort();
    const layers = Object.keys(s.layers).sort();
    const pick = (i: number) => nodes[i % Math.max(nodes.length, 1)];
    switch (op.k) {
      case 'add':
        addVariableNode(doc, diagramId, { name: op.name, x: op.x, y: 0, layerId: layers[0]! });
        break;
      case 'link': {
        const a = pick(op.i);
        const b = pick(op.j);
        if (a && b && a !== b)
          addElement(doc, diagramId, {
            type: 'link',
            layerId: layers[0]!,
            from: a,
            to: b,
            control: null,
            polarity: '+',
          });
        break;
      }
      case 'del': {
        const a = pick(op.i);
        if (a) deleteElements(doc, diagramId, [a]);
        break;
      }
      case 'move': {
        const a = pick(op.i);
        if (a) moveElements(doc, diagramId, [{ id: a, dx: op.d, dy: op.d }]);
        break;
      }
      case 'layer':
        if (layers.length > 1) deleteLayer(doc, diagramId, layers[layers.length - 1]!, null);
        else addLayer(doc, diagramId, 'L');
        break;
    }
  }

  it('replicas converge to a valid document under concurrent edits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(opArb, { maxLength: 12 }), { minLength: 3, maxLength: 3 }),
        (scripts) => {
          const origin = new Y.Doc();
          initDoc(origin);
          const diagramId = Object.keys(toSnapshot(origin).diagrams)[0]!;
          const base = Y.encodeStateAsUpdate(origin);
          const replicas = scripts.map(() => {
            const d = new Y.Doc();
            Y.applyUpdate(d, base);
            return d;
          });
          // Offline phase: every replica edits independently.
          replicas.forEach((d, i) => scripts[i]!.forEach((op) => apply(d, diagramId, op)));
          // Sync everything in every direction.
          const updates = replicas.map((d) => Y.encodeStateAsUpdate(d));
          replicas.forEach((d) => updates.forEach((u) => Y.applyUpdate(d, u)));
          // Each replica repairs independently, then sync again.
          replicas.forEach((d) => repairDoc(d));
          const updates2 = replicas.map((d) => Y.encodeStateAsUpdate(d));
          replicas.forEach((d) => updates2.forEach((u) => Y.applyUpdate(d, u)));
          const snaps = replicas.map((d) => canonical(toSnapshot(d)));
          expect(new Set(snaps).size).toBe(1);
          const snap = toSnapshot(replicas[0]!);
          expect(snapshotSchema.safeParse(snap).success).toBe(true);
          // Invariants
          const names = Object.values(snap.variables).map((v) => v.name.toLowerCase());
          expect(new Set(names).size).toBe(names.length);
          for (const d of Object.values(snap.diagrams)) {
            expect(Object.keys(d.layers).length).toBeGreaterThan(0);
            for (const e of Object.values(d.elements)) {
              expect(d.layers[e.layerId]).toBeDefined();
              if (e.type === 'link') {
                expect(d.elements[e.from]?.type).toBe('variable');
                expect(d.elements[e.to]?.type).toBe('variable');
              }
              if (e.type === 'variable') expect(snap.variables[e.variableId]).toBeDefined();
            }
          }
          // Repair is idempotent once converged.
          expect(repairDoc(replicas[0]!)).toBe(false);
          expect(roots(replicas[0]!).diagrams.size).toBeGreaterThan(0);
        },
      ),
      { numRuns: 150 },
    );
  });
});
