import {
  SCHEMA_VERSION,
  keyAfter,
  nKeys,
  newId,
  type Diagram,
  type DiagramElement,
  type Link,
  type ProjectSnapshot,
  type Variable,
} from '@cld/model';
import {
  fontFieldColor,
  rgbToHex,
  splitFields,
  splitOutsideQuotes,
  unquote,
  vensimKey,
} from './util.js';

export interface MdlParseResult {
  snapshot: ProjectSnapshot;
  warnings: string[];
}

export const SKETCH_MARKER = '\\\\\\---///';
export const SKETCH_END = '///---\\\\\\';
const OBJECT_LINE = /^-?\d+,-?\d+,/;
export const MAX_MDL_BYTES = 5 * 1024 * 1024;

export interface EquationInfo {
  name: string;
  causes: string[] | null;
  units: string;
  notes: string;
}

/** Parse one equation block (`Name = expr ~ units ~ notes |`). */
export function parseEquation(block: string): EquationInfo | null {
  const joined = block.replace(/\\\r?\n[\t ]*/g, '');
  const parts = splitOutsideQuotes(joined, '~');
  const eq = parts[0] ?? '';
  const eqParts = splitOutsideQuotes(eq, '=');
  if (eqParts.length < 2) return null;
  const rawName = eqParts[0]!.trim();
  if (!rawName || rawName.includes(':') || rawName.includes('[')) return null;
  const expr = eqParts.slice(1).join('=').trim();
  const afo = expr.match(/^A FUNCTION OF\s*\(([\s\S]*)\)\s*$/i);
  const causes = afo
    ? splitOutsideQuotes(afo[1]!, ',')
        .map((c) => unquote(c))
        .filter((c) => c.length > 0)
    : null;
  const clean = (s: string | undefined) => (s ?? '').replace(/\|\s*$/, '').trim();
  return { name: unquote(rawName), causes, units: clean(parts[1]), notes: clean(parts[2]) };
}

export const causesKey = (causes: string[]): string =>
  [...new Set(causes.map(vensimKey))].sort().join('\u0001');

/** Parse a Vensim `.mdl` file into a project snapshot. Never throws on content; collects warnings. */
export function parseMdl(input: string): MdlParseResult {
  const warnings: string[] = [];
  if (input.length > MAX_MDL_BYTES) throw new Error('File is too large (max 5 MB).');
  const lineEnding = input.includes('\r\n') ? '\r\n' : '\n';
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const variables: Record<string, Variable> = {};
  const byKey = new Map<string, string>();
  let i = 0;

  // ---- equations
  let preamble = '';
  if (lines[0]?.startsWith('{')) preamble = `${lines[i++]}\n`;
  let cur: string[] = [];
  let last: Variable | undefined;
  let order = 0;
  let sawSketch = false;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('****') || line.startsWith(SKETCH_MARKER)) break;
    if (cur.length === 0 && line.trim() === '') {
      if (last?.mdl) last.mdl.equation += `${line}\n`;
      else preamble += `${line}\n`;
      continue;
    }
    cur.push(line);
    if (line.trimEnd().endsWith('|')) {
      const raw = `${cur.join('\n')}\n`;
      const info = parseEquation(raw);
      cur = [];
      if (!info) {
        warnings.push(`Unsupported equation kept as-is near line ${i + 1}.`);
        if (last?.mdl) last.mdl.equation += raw;
        else preamble += raw;
        continue;
      }
      const id = newId();
      last = {
        id,
        name: info.name,
        ...(info.units ? { units: info.units } : {}),
        ...(info.notes ? { notes: info.notes } : {}),
        mdl: {
          equation: raw,
          name: info.name,
          order: order++,
          ...(info.causes ? { causesKey: causesKey(info.causes) } : {}),
        },
      };
      variables[id] = last;
      byKey.set(vensimKey(info.name), id);
    }
  }
  if (cur.length) {
    warnings.push('Unterminated equation at end of equations section.');
    preamble += `${cur.join('\n')}\n`;
  }
  let controlSection = '';
  for (; i < lines.length && !lines[i]!.startsWith(SKETCH_MARKER); i++)
    controlSection += `${lines[i]}\n`;

  // ---- sketch
  const diagrams: Record<string, Diagram> = {};
  let sketchHeader = '';
  let settings = '';
  const nodeSeen = new Set<string>();
  if (i < lines.length) {
    sawSketch = true;
    sketchHeader = `${lines[i++]}\n`;
    if (lines[i]?.startsWith('V')) sketchHeader += `${lines[i++]}\n`;
    const diagramOrders: string[] = [];
    let view: {
      diagram: Diagram;
      layerId: string;
      ids: Map<number, string>;
      elements: DiagramElement[];
    } | null = null;

    const finishView = () => {
      if (!view) return;
      const keys = nKeys(view.elements.length);
      view.elements.forEach((el, k) => {
        el.z = keys[k]!;
        view!.diagram.elements[el.id] = el;
      });
      // Resolve link endpoints from sketch ids to element ids; unresolvable links are kept raw.
      for (const el of view.elements) {
        if (el.type !== 'link') continue;
        const from = view.ids.get(Number(el.from));
        const to = view.ids.get(Number(el.to));
        const fromEl = from ? view.diagram.elements[from] : undefined;
        const toEl = to ? view.diagram.elements[to] : undefined;
        if (fromEl?.type === 'variable' && toEl?.type === 'variable') {
          el.from = from!;
          el.to = to!;
        } else {
          delete view.diagram.elements[el.id];
          view.diagram.mdl!.unknown!.push({
            sketchId: el.mdl!.sketchId!,
            lines: [rebuildLinkLine(el)],
          });
        }
      }
      diagrams[view.diagram.id] = view.diagram;
      view = null;
    };

    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith(SKETCH_END)) break;
      if (line.startsWith('*')) {
        finishView();
        const order = keyAfter(diagramOrders);
        diagramOrders.push(order);
        const layerId = newId();
        const diagram: Diagram = {
          id: newId(),
          name: line.slice(1).trim() || 'View',
          order,
          layers: {
            [layerId]: {
              id: layerId,
              name: 'Base',
              order: keyAfter([]),
              visible: true,
              locked: false,
            },
          },
          elements: {},
          mdl: { viewLine: line, unknown: [] },
        };
        const header: string[] = [];
        while (lines[i + 1]?.startsWith('$')) header.push(lines[++i]!);
        if (header.length) diagram.mdl!.headerLine = header.join('\n');
        view = { diagram, layerId, ids: new Map(), elements: [] };
        continue;
      }
      if (!view) {
        if (line.trim()) warnings.push(`Ignored sketch line ${i + 1} outside of a view.`);
        continue;
      }
      if (!OBJECT_LINE.test(line)) {
        // Continuation text of an unknown object.
        const unk = view.diagram.mdl!.unknown!;
        if (unk.length) unk[unk.length - 1]!.lines.push(line);
        else if (line.trim()) warnings.push(`Ignored sketch line ${i + 1}.`);
        continue;
      }
      const type = line.slice(0, line.indexOf(','));
      if (type === '1') {
        const bar = line.indexOf('|');
        const head = bar >= 0 ? line.slice(0, bar) : line;
        const points = bar >= 0 ? line.slice(bar + 1) : '';
        const f = splitFields(head);
        const sketchId = Number(f[1]);
        const pts = [...points.matchAll(/\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/g)].map((m) => ({
          x: Number(m[1]),
          y: Number(m[2]),
        }));
        const p = pts[0];
        const el: Link = {
          id: newId(),
          type: 'link',
          layerId: view.layerId,
          z: '',
          from: f[2] ?? '',
          to: f[3] ?? '',
          control: f[4] !== '0' && p && !(p.x === 0 && p.y === 0) ? p : null,
          polarity: polarityFromCode(f[6]),
          mdl: { sketchId, fields: f, text: points },
        };
        const color = rgbToHex(f[11]);
        if (color) el.style = { color };
        if (pts.length > 1)
          warnings.push(
            `Link ${sketchId} has ${pts.length} points; only the first is used for its curve.`,
          );
        view.ids.set(sketchId, el.id);
        view.elements.push(el);
        continue;
      }
      const f = splitFields(line);
      const sketchId = Number(f[1]);
      if (type === '10') {
        const rawName = f[2] ?? '';
        const name = unquote(rawName);
        let variableId = byKey.get(vensimKey(name));
        if (!variableId) {
          variableId = newId();
          variables[variableId] = { id: variableId, name };
          byKey.set(vensimKey(name), variableId);
          warnings.push(`"${name}" appears in the sketch without an equation.`);
        }
        const isShadow = nodeSeen.has(variableId);
        nodeSeen.add(variableId);
        const textColor = fontFieldColor(f);
        const el: DiagramElement = {
          id: newId(),
          type: 'variable',
          layerId: view.layerId,
          z: '',
          variableId,
          x: Number(f[3]),
          y: Number(f[4]),
          w: Number(f[5]) * 2,
          h: Number(f[6]) * 2,
          form: 'none',
          ...(isShadow ? { isShadow: true } : {}),
          ...(textColor ? { style: { textColor } } : {}),
          mdl: { sketchId, fields: f, rawName },
        };
        view.ids.set(sketchId, el.id);
        view.elements.push(el);
        continue;
      }
      if (type === '12') {
        const bits = Number(f[8]);
        let text: string | undefined;
        if (bits & 4 && i + 1 < lines.length && !lines[i + 1]!.startsWith(SKETCH_END))
          text = lines[++i]!;
        const shape = f[7];
        const base = {
          id: newId(),
          layerId: view.layerId,
          z: '',
          mdl: { sketchId, fields: f, ...(text !== undefined ? { text } : {}) },
        };
        let el: DiagramElement;
        if (shape === '4' || shape === '5') {
          const label = (text ?? '').trim();
          el = {
            ...base,
            type: 'loop',
            x: Number(f[3]),
            y: Number(f[4]),
            r: Number(f[5]),
            kind: /^r/i.test(label) ? 'R' : /^b/i.test(label) ? 'B' : 'custom',
            label,
            direction: shape === '4' ? 'cw' : 'ccw',
          };
        } else {
          el = {
            ...base,
            type: 'text',
            x: Number(f[3]),
            y: Number(f[4]),
            w: Number(f[5]) * 2,
            h: Number(f[6]) * 2,
            text: text ?? '',
          };
        }
        view.ids.set(sketchId, el.id);
        view.elements.push(el);
        continue;
      }
      view.diagram.mdl!.unknown!.push({ sketchId, lines: [line] });
      warnings.push(
        `Sketch object type ${type} (id ${sketchId}) is not editable and will be preserved as-is.`,
      );
    }
    finishView();
    settings = lines.slice(i).join('\n');
  }
  if (!sawSketch) warnings.push('The file has no sketch section; an empty diagram was created.');
  if (Object.keys(diagrams).length === 0) {
    const layerId = newId();
    const d: Diagram = {
      id: newId(),
      name: 'View 1',
      order: keyAfter([]),
      layers: {
        [layerId]: { id: layerId, name: 'Base', order: keyAfter([]), visible: true, locked: false },
      },
      elements: {},
    };
    diagrams[d.id] = d;
  }
  for (const d of Object.values(diagrams)) if (d.mdl?.unknown?.length === 0) delete d.mdl.unknown;
  for (const v of Object.values(variables)) if (!nodeSeen.has(v.id) && v.mdl) v.mdl.unplaced = true;

  return {
    snapshot: {
      meta: {
        schemaVersion: SCHEMA_VERSION,
        vensim: { preamble, controlSection, sketchHeader, settings, lineEnding },
      },
      variables,
      diagrams,
      comments: {},
    },
    warnings,
  };
}

export function polarityFromCode(code: string | undefined): Link['polarity'] {
  const n = Number(code);
  if (!n) return null;
  const ch = String.fromCharCode(n);
  if (ch === '+' || ch === 'S' || ch === 'P') return '+';
  if (ch === '-' || ch === 'O' || ch === 'N') return '-';
  return '?';
}

function rebuildLinkLine(el: Link): string {
  const f = el.mdl!.fields!;
  return `${f.join(',')}|${el.mdl!.text ?? ''}`;
}
