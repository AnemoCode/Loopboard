import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addDiagram,
  addElement,
  addVariableNode,
  addThread,
  deleteElements,
  describeChanges,
  initDoc,
  moveElements,
  pasteElements,
  copyElements,
  renameVariable,
  reorderElements,
  setStyle,
  toSnapshot,
  updateElement,
  type ProjectSnapshot,
} from '../src/index.js';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const s = toSnapshot(doc);
  const d = Object.values(s.diagrams)[0]!;
  return { doc, diagramId: d.id, layerId: Object.keys(d.layers)[0]! };
}

/** Run `fn` and return the summaries describing what it changed. */
function changes(doc: Y.Doc, fn: () => void): string[] {
  const before: ProjectSnapshot = toSnapshot(doc);
  fn();
  return describeChanges(before, toSnapshot(doc)).map((e) => e.summary);
}

describe('describeChanges', () => {
  it('lists individual edits', () => {
    const { doc, diagramId, layerId } = setup();
    let a = '';
    let b = '';
    expect(
      changes(
        doc,
        () => (a = addVariableNode(doc, diagramId, { name: 'Births', x: 0, y: 0, layerId })),
      ),
    ).toEqual(['added variable “Births”']);
    b = addVariableNode(doc, diagramId, { name: 'Population', x: 200, y: 0, layerId });
    let l = '';
    expect(
      changes(
        doc,
        () =>
          (l = addElement(doc, diagramId, {
            type: 'link',
            layerId,
            from: a,
            to: b,
            control: null,
            polarity: '+',
          })),
      ),
    ).toEqual(['added link “Births → Population” (+)']);
    expect(changes(doc, () => updateElement(doc, diagramId, l, { polarity: '-' }))).toEqual([
      'set polarity of “Births → Population” to –',
    ]);
    expect(changes(doc, () => updateElement(doc, diagramId, l, { delay: true }))).toEqual([
      'added a delay mark to “Births → Population”',
    ]);
    expect(
      changes(doc, () => updateElement(doc, diagramId, l, { control: { x: 100, y: 50 } })),
    ).toEqual(['curved link “Births → Population”']);
    const vid = toSnapshot(doc).diagrams[diagramId]!.elements[a]!;
    expect(
      changes(doc, () =>
        renameVariable(doc, (vid as { variableId: string }).variableId, 'Birth rate'),
      ),
    ).toEqual(['renamed “Births” to “Birth rate”']);
    expect(
      changes(doc, () => setStyle(doc, diagramId, [a], { textColor: '#dc2626', fill: '#fef2f2' })),
    ).toEqual(['changed text color and fill of “Birth rate”']);
    expect(changes(doc, () => updateElement(doc, diagramId, a, { form: 'rect' }))).toEqual([
      'changed “Birth rate” to box',
    ]);
  });

  it('groups moves and reorderings into one layout entry', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 0, layerId });
    addElement(doc, diagramId, {
      type: 'link',
      layerId,
      from: a,
      to: b,
      control: { x: 50, y: 30 },
      polarity: '+',
    });
    const before = toSnapshot(doc);
    moveElements(doc, diagramId, [{ id: a, dx: 10, dy: 0 }]);
    const entries = describeChanges(before, toSnapshot(doc));
    // The link's control point followed the move: no separate "curved" entry.
    expect(entries).toEqual([
      { kind: 'layout', summary: 'moved 1 element', diagramId, elementIds: [a] },
    ]);
    expect(changes(doc, () => reorderElements(doc, diagramId, [a], 'front'))).toEqual([
      'moved 1 element',
    ]);
  });

  it('folds attached links into deletions and summarises bulk operations', () => {
    const { doc, diagramId, layerId } = setup();
    const a = addVariableNode(doc, diagramId, { name: 'A', x: 0, y: 0, layerId });
    const b = addVariableNode(doc, diagramId, { name: 'B', x: 100, y: 0, layerId });
    addElement(doc, diagramId, {
      type: 'link',
      layerId,
      from: a,
      to: b,
      control: null,
      polarity: null,
    });
    addElement(doc, diagramId, {
      type: 'link',
      layerId,
      from: b,
      to: a,
      control: null,
      polarity: null,
    });
    expect(changes(doc, () => deleteElements(doc, diagramId, [a]))).toEqual([
      'deleted variable “A” and 2 attached links',
    ]);

    const c = addVariableNode(doc, diagramId, { name: 'C', x: 0, y: 100, layerId });
    addElement(doc, diagramId, {
      type: 'link',
      layerId,
      from: b,
      to: c,
      control: null,
      polarity: null,
    });
    const items = copyElements(doc, diagramId, [b, c]);
    const pasted = changes(doc, () => {
      pasteElements(doc, diagramId, items, layerId, 20, 20);
      pasteElements(doc, diagramId, items, layerId, 40, 40);
    });
    expect(pasted).toEqual(['added 4 variables and 2 links']);
  });

  it('describes diagrams, comments and reorderings of diagrams', () => {
    const { doc, diagramId } = setup();
    expect(changes(doc, () => addDiagram(doc, 'Finance'))).toEqual(['added diagram “Finance”']);
    expect(
      changes(doc, () =>
        addThread(doc, {
          diagramId,
          x: 0,
          y: 0,
          createdBy: 'u1',
          createdAt: 1,
          body: 'Is this right?',
          authorName: 'Maya',
        }),
      ),
    ).toEqual(['commented: “Is this right?”']);
  });
});
