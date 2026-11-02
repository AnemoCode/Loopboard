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
  /**
   * Optional placement and names for loop markers, matched by the nodes a loop runs through.
   * `direction` overrides the detected one (needed for two-variable loops, which have no area).
   */
  loops?: {
    through: string[];
    at: [x: number, y: number];
    name?: string;
    direction?: 'cw' | 'ccw';
  }[];
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
  const snap = toSnapshot(doc);
  const variableOf = (key: string) => {
    const el = snap.diagrams[diagramId]!.elements[ids[key]!];
    return el?.type === 'variable' ? el.variableId : '';
  };
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const counts = { R: 0, B: 0 };
  for (const loop of findLoops(snap.diagrams[diagramId]!).loops) {
    if (loop.kind === '?') continue;
    const placed = spec.loops?.find((l) => sameSet(l.through.map(variableOf), loop.variableIds));
    const label = `${loop.kind}${++counts[loop.kind]}`;
    const at = placed
      ? { x: placed.at[0], y: placed.at[1] }
      : freeSpotNear(toSnapshot(doc).diagrams[diagramId]!, loop.center);
    addElement(doc, diagramId, {
      type: 'loop',
      layerId,
      x: at.x,
      y: at.y,
      r: 26,
      kind: loop.kind,
      label,
      ...(placed?.name ? { name: placed.name } : {}),
      direction: placed?.direction ?? loop.direction,
      loopKey: loop.key,
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
    id: 'engine-of-growth',
    name: 'Engine of Growth',
    description:
      'Innovation drives growth, and efficiency gains rebound into more consumption: two reinforcing loops.',
    build: () =>
      build({
        nodes: {
          growth: ['Economic growth', 120, 380],
          innovation: ['Incremental innovation', 300, 170],
          efficiency: ['Material and energy efficiency', 660, 90],
          costs: ['Consumer costs', 860, 400],
          consumption: ['Consumption', 360, 580],
          lifespan: ['Product lifespan', 560, 370],
        },
        links: [
          ['growth', 'innovation', '+', -0.2],
          ['innovation', 'efficiency', '+', -0.15],
          ['efficiency', 'costs', '-', -0.2],
          ['costs', 'consumption', '-', -0.15],
          ['innovation', 'lifespan', '-', -0.15],
          ['lifespan', 'consumption', '-', -0.1],
          ['consumption', 'growth', '+', -0.2],
        ],
        loops: [
          {
            through: ['growth', 'innovation', 'lifespan', 'consumption'],
            at: [330, 370],
            name: 'Engine of Growth',
          },
          {
            through: ['growth', 'innovation', 'efficiency', 'costs', 'consumption'],
            at: [660, 230],
            name: 'Consumption Rebound Effect',
          },
        ],
      }),
  },
  {
    id: 'word-of-mouth',
    name: 'Word of Mouth',
    description:
      'Word of mouth grows the customer base (reinforcing) while customer losses hold it back (balancing).',
    build: () =>
      build({
        nodes: {
          sales: ['Sales from Word of Mouth', 160, 300],
          base: ['Customer Base', 440, 300],
          loss: ['Customer Loss Rate', 720, 300],
        },
        links: [
          ['sales', 'base', '+', -0.4],
          ['base', 'sales', '+', -0.4],
          ['loss', 'base', '-', 0.4],
          ['base', 'loss', '+', 0.4],
        ],
        loops: [
          { through: ['sales', 'base'], at: [300, 300], direction: 'cw' },
          { through: ['base', 'loss'], at: [580, 300], direction: 'ccw' },
        ],
      }),
  },
  {
    id: 'perceived-quality',
    name: 'Perceived Quality',
    description:
      'A balancing quality loop slowed by delays and skewed by biases in how management perceives quality.',
    build: () =>
      build({
        nodes: {
          quality: ['Product Quality', 120, 210],
          reported: ['Reported Product Quality', 420, 170],
          reportingBias: ['Bias in Reporting System', 290, 40],
          perception: ['Management Perception of Product Quality', 620, 370],
          managementBias: ['Management Bias Toward High Quality', 840, 190],
          desired: ['Desired Product Quality', 860, 440],
          shortfall: ['Quality Shortfall', 560, 560],
          programs: ['Quality Improvement Programs', 200, 560],
        },
        links: [
          ['quality', 'reported', '+', -0.12, true],
          ['reported', 'perception', '+', -0.12, true],
          ['perception', 'shortfall', '-', -0.1],
          ['shortfall', 'programs', '+', -0.1, true],
          ['programs', 'quality', '+', -0.15, true],
          ['reportingBias', 'reported', '+', 0.12],
          ['managementBias', 'perception', '+', 0],
          ['desired', 'shortfall', '+', 0],
        ],
        loops: [
          {
            through: ['quality', 'reported', 'perception', 'shortfall', 'programs'],
            at: [370, 380],
          },
        ],
      }),
  },
];
