import {
  byKey,
  type Diagram,
  type DiagramElement,
  type Link,
  type ProjectSnapshot,
  type Variable,
} from '@cld/model';
import { causesKey, parseEquation, polarityFromCode } from './parse.js';
import { fontFieldColor, hexToRgb, quoteName, rgbToHex, splitFields, unquote } from './util.js';

export interface MdlWriteResult {
  text: string;
  warnings: string[];
}

const DEFAULT_PREAMBLE = '{UTF-8}\n';
const DEFAULT_CONTROL = `********************************************************
\t.Control
********************************************************~
\t\tSimulation Control Parameters
\t|

FINAL TIME  = 100
\t~\tMonth
\t~\tThe final time for the simulation.
\t|

INITIAL TIME  = 0
\t~\tMonth
\t~\tThe initial time for the simulation.
\t|

SAVEPER  =
        TIME STEP
\t~\tMonth [0,?]
\t~\tThe frequency with which output is stored.
\t|

TIME STEP  = 1
\t~\tMonth [0,?]
\t~\tThe time step for the simulation.
\t|

`;
const DEFAULT_SKETCH_HEADER =
  '\\\\\\---/// Sketch information - do not modify anything except names\nV300  Do not put anything below this section - it will be ignored\n';
const DEFAULT_VIEW_HEADER =
  '$-1--1--1,0,|12||-1--1--1|-1--1--1|-1--1--1|-1--1--1|-1--1--1|96,96,100,0';
const DEFAULT_SETTINGS = `///---\\\\\\
:L<%^E!@
5:Time
19:100,0
24:0
25:0
26:0
23:0
15:0,0,0,0,0,0
27:0,
34:0,
42:0
72:0
73:0
95:0
96:0
97:0
77:0
78:0
102:1
93:0
94:0
92:0
91:0
90:0
87:0
75:
43:
103:8,8,8,3,8
105:0,0,0,0,0,0,0,0,0,0
104:Vensim Sans|12||0-0-0|0-0-0|-1--1--1|0-0-255|192-192-192|-1--1--1
`;

const VAR_TEMPLATE = [
  '10',
  '0',
  '',
  '0',
  '0',
  '0',
  '0',
  '8',
  '3',
  '0',
  '0',
  '-1',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
];
const LINK_TEMPLATE = [
  '1',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '192',
  '0',
  '-1--1--1',
  '',
  '1',
];
const COMMENT_TEMPLATE = [
  '12',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '8',
  '3',
  '0',
  '0',
  '-1',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
];

const round = (n: number) => String(Math.round(n));

/** Keep the original field text when it still encodes `value`; otherwise write the new value. */
function setNum(f: string[], i: number, value: number) {
  if (Number(f[i]) !== Math.round(value)) f[i] = round(value);
}

const POLARITY_CODES: Record<string, string> = { '+': '43', '-': '45', '?': '63' };

/** Serialise a project snapshot to Vensim `.mdl`. Unchanged content round-trips byte-for-byte. */
export function writeMdl(snap: ProjectSnapshot): MdlWriteResult {
  const warnings = new Set<string>();
  const vensim = snap.meta.vensim ?? {};
  const out: string[] = [];
  out.push(vensim.preamble ?? DEFAULT_PREAMBLE);

  // ---- equations: causes come from links between variable nodes across all diagrams.
  const causes = new Map<string, Set<string>>();
  for (const d of Object.values(snap.diagrams)) {
    for (const el of Object.values(d.elements)) {
      if (el.type !== 'link') continue;
      const from = d.elements[el.from];
      const to = d.elements[el.to];
      if (from?.type !== 'variable' || to?.type !== 'variable') continue;
      if (!causes.has(to.variableId)) causes.set(to.variableId, new Set());
      causes.get(to.variableId)!.add(from.variableId);
    }
  }
  const vars = Object.values(snap.variables).sort((a, b) => {
    const oa = a.mdl?.order ?? Infinity;
    const ob = b.mdl?.order ?? Infinity;
    return oa - ob || a.name.localeCompare(b.name);
  });
  for (const v of vars) out.push(equationFor(v, causes, snap, warnings));
  out.push(vensim.controlSection ?? DEFAULT_CONTROL);

  // ---- sketch
  out.push(vensim.sketchHeader ?? DEFAULT_SKETCH_HEADER);
  const diagrams = Object.values(snap.diagrams).sort(byKey((d) => d.order));
  for (const d of diagrams) out.push(viewFor(d, snap, warnings));
  out.push(vensim.settings ?? DEFAULT_SETTINGS);

  let text = out.join('');
  if (vensim.lineEnding === '\r\n') text = text.replace(/\n/g, '\r\n');
  return { text, warnings: [...warnings] };
}

function equationFor(
  v: Variable,
  causes: Map<string, Set<string>>,
  snap: ProjectSnapshot,
  warnings: Set<string>,
): string {
  const names = [...(causes.get(v.id) ?? [])]
    .map((id) => snap.variables[id]?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const raw = v.mdl?.equation;
  if (raw) {
    const info = parseEquation(raw);
    const sameMeta =
      info &&
      info.name === v.name &&
      info.units === (v.units ?? '') &&
      info.notes === (v.notes ?? '');
    if (sameMeta && (v.mdl?.causesKey === undefined || v.mdl.causesKey === causesKey(names)))
      return raw;
    if (info && v.mdl?.causesKey === undefined)
      warnings.add(`The equation of "${v.name}" was replaced because the variable changed.`);
  }
  const units = v.units ?? '';
  const notes = v.notes ?? '';
  const head = `${quoteName(v.name)}  = A FUNCTION OF( ${names.map(quoteName).join(',')})\n`;
  return units || notes
    ? `${head}\t~\t${units}\n\t~\t${notes}\n\t|\n\n`
    : `${head}\t~\t\n\t~\t\t|\n\n`;
}

interface Item {
  sort: number;
  el?: DiagramElement;
  unknown?: { sketchId: number; lines: string[] };
}

function viewFor(d: Diagram, snap: ProjectSnapshot, warnings: Set<string>): string {
  const viewLine =
    d.mdl?.viewLine && d.mdl.viewLine.slice(1).trim() === d.name
      ? d.mdl.viewLine
      : `*${d.name.replace(/[\r\n]/g, ' ')}`;
  let s = `${viewLine}\n${d.mdl?.headerLine ?? DEFAULT_VIEW_HEADER}\n`;
  // Layers are flattened: every element is exported, hidden layers included (they are part of the model).
  // Imported objects keep their original order, new ones follow (nodes before links).
  const items: Item[] = [];
  const fresh = Object.values(d.elements)
    .filter((el) => el.mdl?.sketchId === undefined)
    .sort(byKey((e) => e.z));
  for (const el of Object.values(d.elements))
    if (el.mdl?.sketchId !== undefined) items.push({ sort: el.mdl.sketchId, el });
  for (const u of d.mdl?.unknown ?? []) items.push({ sort: u.sketchId, unknown: u });
  items.sort((a, b) => a.sort - b.sort);
  for (const el of fresh) if (el.type !== 'link') items.push({ sort: Infinity, el });
  for (const el of fresh) if (el.type === 'link') items.push({ sort: Infinity, el });

  // Links must come after both endpoints: defer them when needed.
  const emitted = new Set<string>();
  const ordered: Item[] = [];
  const pending: Item[] = [];
  const flush = () => {
    for (let k = 0; k < pending.length; k++) {
      const l = pending[k]!.el as Link;
      if (emitted.has(l.from) && emitted.has(l.to)) {
        ordered.push(pending[k]!);
        emitted.add(l.id);
        pending.splice(k--, 1);
      }
    }
  };
  for (const item of items) {
    if (item.el?.type === 'link' && !(emitted.has(item.el.from) && emitted.has(item.el.to))) {
      pending.push(item);
      continue;
    }
    ordered.push(item);
    if (item.el) emitted.add(item.el.id);
    flush();
  }
  ordered.push(
    ...pending.filter((p) => d.elements[(p.el as Link).from] && d.elements[(p.el as Link).to]),
  );

  // Assign consecutive sketch ids.
  const newIds = new Map<string, number>();
  const oldToNew = new Map<number, number>();
  ordered.forEach((item, k) => {
    const id = k + 1;
    if (item.el) newIds.set(item.el.id, id);
    const old = item.el?.mdl?.sketchId ?? item.unknown?.sketchId;
    if (old !== undefined) oldToNew.set(old, id);
  });

  for (const item of ordered) {
    if (item.unknown) {
      const [first, ...rest] = item.unknown.lines;
      const bar = first!.indexOf('|');
      const isLink = first!.startsWith('1,');
      const head = isLink && bar >= 0 ? first!.slice(0, bar) : first!;
      const tail = isLink && bar >= 0 ? first!.slice(bar) : '';
      const f = splitFields(head);
      const remap = (i: number) => {
        const n = oldToNew.get(Number(f[i]));
        if (n !== undefined) f[i] = String(n);
      };
      remap(1);
      if (isLink) {
        remap(2);
        remap(3);
      }
      s += [`${f.join(',')}${tail}`, ...rest].map((l) => `${l}\n`).join('');
      continue;
    }
    s += elementLines(item.el!, newIds, snap, warnings);
  }
  return s;
}

function elementLines(
  el: DiagramElement,
  ids: Map<string, number>,
  snap: ProjectSnapshot,
  warnings: Set<string>,
): string {
  const id = String(ids.get(el.id));
  switch (el.type) {
    case 'variable': {
      const f = [...(el.mdl?.fields ?? VAR_TEMPLATE)];
      f[0] = '10';
      f[1] = id;
      const name = snap.variables[el.variableId]?.name ?? 'Unnamed';
      f[2] =
        el.mdl?.rawName !== undefined && unquote(el.mdl.rawName) === name
          ? el.mdl.rawName
          : quoteName(name);
      setNum(f, 3, el.x);
      setNum(f, 4, el.y);
      setNum(f, 5, el.w / 2);
      setNum(f, 6, el.h / 2);
      const color = el.style?.textColor ?? null;
      if (color !== fontFieldColor(f)) {
        if (color) {
          f.splice(
            15,
            f.length - 15,
            '0-0-0',
            '0-0-0',
            `|||${hexToRgb(color)}`,
            '0',
            '0',
            '0',
            '0',
            '0',
            '0',
          );
          f[9] = '2';
        } else {
          f.splice(15, f.length - 15, '0', '0', '0', '0', '0', '0');
          f[9] = '0';
        }
      }
      if (el.form !== 'none')
        warnings.add(
          'Variable box shapes are not exported to Vensim (variables are written as plain text).',
        );
      if (el.style && Object.keys(el.style).some((k) => k !== 'textColor'))
        warnings.add('Fonts, fills and borders are not exported to Vensim; only text colors are.');
      return `${f.join(',')}\n`;
    }
    case 'link': {
      const f = [...(el.mdl?.fields ?? LINK_TEMPLATE)];
      f[0] = '1';
      f[1] = id;
      f[2] = String(ids.get(el.from));
      f[3] = String(ids.get(el.to));
      if (polarityFromCode(f[6]) !== el.polarity)
        f[6] = el.polarity ? POLARITY_CODES[el.polarity]! : '0';
      const color = el.style?.color ?? null;
      if (color !== rgbToHex(f[11])) f[11] = hexToRgb(color);
      let points = el.mdl?.text ?? '';
      const orig = el.mdl?.fields ? origControl(el.mdl.fields, points) : undefined;
      const same =
        orig !== undefined &&
        (orig === null
          ? el.control === null
          : !!el.control &&
            Math.round(el.control.x) === orig.x &&
            Math.round(el.control.y) === orig.y);
      if (!same) {
        f[4] = el.control ? '1' : '0';
        f[13] = '1';
        points = el.control ? `(${round(el.control.x)},${round(el.control.y)})|` : '(0,0)|';
      }
      if (el.delay) warnings.add('Delay marks are not exported to Vensim.');
      if (el.label) warnings.add('Link labels are not exported to Vensim.');
      if (el.style?.dash || el.style?.width || el.style?.head)
        warnings.add('Arrow line styles are not exported to Vensim; only colors are.');
      return `${f.join(',')}|${points}\n`;
    }
    case 'loop': {
      const f = [...(el.mdl?.fields ?? COMMENT_TEMPLATE)];
      f[0] = '12';
      f[1] = id;
      setNum(f, 3, el.x);
      setNum(f, 4, el.y);
      if (!el.mdl?.fields) {
        f[5] = round(el.r);
        f[6] = round(el.r);
        f[8] = '7';
      } else if (Number(f[5]) !== Math.round(el.r)) {
        f[5] = round(el.r);
        f[6] = round(el.r);
      }
      f[7] = el.direction === 'cw' ? '4' : '5';
      f[8] = String(Number(f[8]) | 4);
      const text =
        el.mdl?.text !== undefined && el.mdl.text.trim() === el.label ? el.mdl.text : el.label;
      if (el.name)
        warnings.add('Loop names are not exported to Vensim (only the label, e.g. "R1").');
      return `${f.join(',')}\n${text}\n`;
    }
    case 'text':
    case 'shape': {
      const f = [...(el.mdl?.fields ?? COMMENT_TEMPLATE)];
      f[0] = '12';
      f[1] = id;
      setNum(f, 3, el.x);
      setNum(f, 4, el.y);
      setNum(f, 5, el.w / 2);
      setNum(f, 6, el.h / 2);
      const value = (el.text ?? '').replace(/\r?\n/g, ' ');
      if (el.type === 'shape') warnings.add('Shapes are exported to Vensim as comments.');
      if (el.text?.includes('\n')) warnings.add('Line breaks in text are exported as spaces.');
      const text = el.mdl?.text !== undefined && el.mdl.text === value ? el.mdl.text : value;
      if (text) f[8] = String(Number(f[8]) | 4);
      else if (!el.mdl?.fields) f[8] = '3';
      return Number(f[8]) & 4 ? `${f.join(',')}\n${text}\n` : `${f.join(',')}\n`;
    }
  }
}

function origControl(fields: string[], points: string): { x: number; y: number } | null {
  const m = points.match(/\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/);
  if (fields[4] === '0' || !m || (Number(m[1]) === 0 && Number(m[2]) === 0)) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}
