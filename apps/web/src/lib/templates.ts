import * as Y from 'yjs';
import {
  addElement,
  addVariableNode,
  controlFromBend,
  findLoops,
  freeSpotNear,
  initDoc,
  roots,
  toSnapshot,
  type Link,
  type ProjectSnapshot,
} from '@cld/model';

interface Spec {
  nodes: Record<string, [name: string, x: number, y: number]>;
  links: [from: string, to: string, polarity: '+' | '-', bend: number, delay?: boolean][];
}

function build(spec: Spec): ProjectSnapshot {
  const doc = new Y.Doc();
  initDoc(doc);
  const diagramId = [...roots(doc).diagrams.keys()][0]!;
  const layerId = [
    ...(roots(doc).diagrams.get(diagramId)!.get('layers') as Y.Map<unknown>).keys(),
  ][0]!;
  const ids: Record<string, string> = {};
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [key, [name, x, y]] of Object.entries(spec.nodes)) {
    ids[key] = addVariableNode(doc, diagramId, { name, x, y, layerId, w: 110 });
    pos[key] = { x, y };
  }
  for (const [from, to, polarity, bend, delay] of spec.links) {
    const control = bend ? controlFromBend(pos[from]!, pos[to]!, { t: 0.5, s: bend }) : null;
    const link: Omit<Link, 'id' | 'z'> = {
      type: 'link',
      layerId,
      from: ids[from]!,
      to: ids[to]!,
      polarity,
      control: control && { x: Math.round(control.x), y: Math.round(control.y) },
    };
    if (delay) link.delay = true;
    addElement(doc, diagramId, link);
  }
  // Loop markers come from loop analysis, so type and direction are always right.
  const counts = { R: 0, B: 0 };
  for (const loop of findLoops(toSnapshot(doc).diagrams[diagramId]!).loops) {
    if (loop.kind === '?') continue;
    const label = `${loop.kind}${++counts[loop.kind]}`;
    const at = freeSpotNear(toSnapshot(doc).diagrams[diagramId]!, loop.center);
    addElement(doc, diagramId, {
      type: 'loop',
      layerId,
      x: at.x,
      y: at.y,
      r: 26,
      kind: loop.kind,
      label,
      direction: loop.direction,
    });
  }
  return toSnapshot(doc);
}

export interface Template {
  id: string;
  name: string;
  description: string;
  build: () => ProjectSnapshot;
}

export const TEMPLATES: Template[] = [
  {
    id: 'fixes-that-fail',
    name: 'Fixes that Fail',
    description:
      'A quick fix relieves a symptom but its side effects make the problem worse later.',
    build: () =>
      build({
        nodes: {
          s: ['Problem symptom', 300, 300],
          f: ['Quick fix', 560, 300],
          u: ['Unintended consequences', 430, 520],
        },
        links: [
          ['s', 'f', '+', -0.25],
          ['f', 's', '-', -0.25],
          ['f', 'u', '+', -0.25, true],
          ['u', 's', '+', -0.25],
        ],
      }),
  },
  {
    id: 'limits-to-growth',
    name: 'Limits to Growth',
    description: 'Growth reinforces itself until a limiting condition slows it down.',
    build: () =>
      build({
        nodes: {
          g: ['Growing action', 200, 320],
          p: ['Performance', 440, 320],
          s: ['Slowing action', 680, 320],
          l: ['Limiting condition', 680, 520],
        },
        links: [
          ['g', 'p', '+', -0.25],
          ['p', 'g', '+', -0.25],
          ['p', 's', '+', -0.25],
          ['s', 'p', '-', -0.25],
          ['l', 's', '+', 0],
        ],
      }),
  },
  {
    id: 'shifting-the-burden',
    name: 'Shifting the Burden',
    description: 'A symptomatic solution weakens the capacity for a fundamental solution.',
    build: () =>
      build({
        nodes: {
          s: ['Problem symptom', 400, 340],
          q: ['Symptomatic solution', 400, 140],
          f: ['Fundamental solution', 400, 560],
          e: ['Side effect', 720, 340],
        },
        links: [
          ['s', 'q', '+', -0.28],
          ['q', 's', '-', -0.28],
          ['s', 'f', '+', 0.28],
          ['f', 's', '-', 0.28, true],
          ['q', 'e', '+', -0.3],
          ['e', 'f', '-', -0.3],
        ],
      }),
  },
];
