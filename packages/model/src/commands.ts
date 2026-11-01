import * as Y from 'yjs';
import {
  diagramToY,
  elementToY,
  getDiagramY,
  getElementsY,
  getLayersY,
  layerToY,
  plainToYMap,
  roots,
  threadToY,
  variableToY,
  type YMap,
} from './doc.js';
import { byKey, keyAfter, keyBetween, newId, normName } from './ids.js';
import { bendFor, controlFromBend } from './geometry.js';
import {
  SCHEMA_VERSION,
  type CommentMessage,
  type CommentThread,
  type Diagram,
  type DiagramElement,
  type Layer,
  type NodeForm,
  type Point,
  type ProjectSnapshot,
  type Style,
  type Variable,
  type VariableNode,
} from './types.js';

/** Distributive Omit so it works on the element union. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewElement = DistOmit<DiagramElement, 'id' | 'z'> & { id?: string; z?: string };

const run = <T>(doc: Y.Doc, origin: unknown, fn: () => T): T => {
  let out!: T;
  doc.transact(() => {
    out = fn();
  }, origin);
  return out;
};

function requireElements(doc: Y.Doc, diagramId: string) {
  const els = getElementsY(doc, diagramId);
  if (!els) throw new Error(`Unknown diagram ${diagramId}`);
  return els;
}

const zKeysInLayer = (els: Y.Map<YMap>, layerId: string) => {
  const keys: string[] = [];
  els.forEach((el) => {
    if (el.get('layerId') === layerId) keys.push(el.get('z') as string);
  });
  return keys;
};

// ---------------------------------------------------------------- project

export function newDiagram(name: string, order: string): Diagram {
  const layerId = newId();
  return {
    id: newId(),
    name,
    order,
    layers: { [layerId]: { id: layerId, name: 'Base', order: keyAfter([]), visible: true, locked: false } },
    elements: {},
  };
}

/** Initialise an empty document with one diagram. Idempotent. */
export function initDoc(doc: Y.Doc, diagramName = 'Main', origin: unknown = 'init'): void {
  run(doc, origin, () => {
    const r = roots(doc);
    if (r.meta.get('schemaVersion') === undefined) r.meta.set('schemaVersion', SCHEMA_VERSION);
    if (r.diagrams.size === 0) {
      const d = newDiagram(diagramName, keyAfter([]));
      r.diagrams.set(d.id, diagramToY(d));
    }
  });
}

export function emptySnapshot(diagramName = 'Main'): ProjectSnapshot {
  const d = newDiagram(diagramName, keyAfter([]));
  return { meta: { schemaVersion: SCHEMA_VERSION }, variables: {}, diagrams: { [d.id]: d }, comments: {} };
}

/** Replace the entire content of `doc` with `snap` (restore / import-replace). */
export function replaceContent(doc: Y.Doc, snap: ProjectSnapshot, origin?: unknown): void {
  run(doc, origin, () => {
    const r = roots(doc);
    r.variables.clear();
    r.diagrams.clear();
    r.comments.clear();
    r.meta.clear();
    r.meta.set('schemaVersion', SCHEMA_VERSION);
    if (snap.meta.vensim) r.meta.set('vensim', snap.meta.vensim);
    for (const v of Object.values(snap.variables)) r.variables.set(v.id, variableToY(v));
    for (const d of Object.values(snap.diagrams)) r.diagrams.set(d.id, diagramToY(d));
    for (const t of Object.values(snap.comments)) r.comments.set(t.id, threadToY(t));
    if (r.diagrams.size === 0) {
      const d = newDiagram('Main', keyAfter([]));
      r.diagrams.set(d.id, diagramToY(d));
    }
  });
}

/**
 * Add the diagrams of `snap` to `doc` as new diagrams (import into existing project).
 * Variables are merged by name: an existing variable is reused and the imported nodes become shadows.
 * Returns the ids of the created diagrams.
 */
export function appendSnapshot(doc: Y.Doc, snap: ProjectSnapshot, origin?: unknown): string[] {
  return run(doc, origin, () => {
    const r = roots(doc);
    const byName = new Map<string, string>();
    r.variables.forEach((v, id) => byName.set(normName(v.get('name') as string), id));
    const varMap = new Map<string, { id: string; existed: boolean }>();
    for (const v of Object.values(snap.variables)) {
      const existing = byName.get(normName(v.name));
      if (existing) varMap.set(v.id, { id: existing, existed: true });
      else {
        const id = newId();
        r.variables.set(id, variableToY({ ...v, id, mdl: undefined }));
        byName.set(normName(v.name), id);
        varMap.set(v.id, { id, existed: false });
      }
    }
    const orders: string[] = [];
    r.diagrams.forEach((d) => orders.push(d.get('order') as string));
    const created: string[] = [];
    const sorted = Object.values(snap.diagrams).sort(byKey((d) => d.order));
    for (const d of sorted) {
      const idMap = new Map<string, string>();
      for (const id of Object.keys(d.elements)) idMap.set(id, newId());
      const layerMap = new Map<string, string>();
      for (const id of Object.keys(d.layers)) layerMap.set(id, newId());
      const order = keyAfter(orders);
      orders.push(order);
      const nd: Diagram = {
        id: newId(),
        name: d.name,
        order,
        layers: Object.fromEntries(
          Object.values(d.layers).map((l) => [layerMap.get(l.id)!, { ...l, id: layerMap.get(l.id)! }]),
        ),
        elements: {},
      };
      for (const el of Object.values(d.elements)) {
        const ne = { ...el, id: idMap.get(el.id)!, layerId: layerMap.get(el.layerId) ?? el.layerId, mdl: undefined } as DiagramElement;
        if (ne.type === 'variable') {
          const vm = varMap.get(ne.variableId);
          if (!vm) continue;
          ne.variableId = vm.id;
          if (vm.existed) ne.isShadow = true;
        } else if (ne.type === 'link') {
          ne.from = idMap.get(ne.from) ?? ne.from;
          ne.to = idMap.get(ne.to) ?? ne.to;
        }
        nd.elements[ne.id] = ne;
      }
      r.diagrams.set(nd.id, diagramToY(nd));
      created.push(nd.id);
    }
    repairDoc(doc);
    return created;
  });
}

// ---------------------------------------------------------------- diagrams

export function addDiagram(doc: Y.Doc, name: string, origin?: unknown): string {
  return run(doc, origin, () => {
    const r = roots(doc);
    const orders: string[] = [];
    r.diagrams.forEach((d) => orders.push(d.get('order') as string));
    const d = newDiagram(name, keyAfter(orders));
    r.diagrams.set(d.id, diagramToY(d));
    return d.id;
  });
}

export function renameDiagram(doc: Y.Doc, diagramId: string, name: string, origin?: unknown): void {
  run(doc, origin, () => getDiagramY(doc, diagramId)?.set('name', name));
}

export function setDiagramOrder(doc: Y.Doc, diagramId: string, order: string, origin?: unknown): void {
  run(doc, origin, () => getDiagramY(doc, diagramId)?.set('order', order));
}

/** Deletes a diagram. The last remaining diagram can't be deleted. */
export function deleteDiagram(doc: Y.Doc, diagramId: string, origin?: unknown): boolean {
  return run(doc, origin, () => {
    const r = roots(doc);
    if (r.diagrams.size <= 1 || !r.diagrams.has(diagramId)) return false;
    r.diagrams.delete(diagramId);
    r.comments.forEach((t, id) => {
      if (t.get('diagramId') === diagramId) r.comments.delete(id);
    });
    collectGarbageVariables(doc);
    return true;
  });
}

export function duplicateDiagram(doc: Y.Doc, diagramId: string, origin?: unknown): string | null {
  return run(doc, origin, () => {
    const r = roots(doc);
    const src = r.diagrams.get(diagramId)?.toJSON() as Diagram | undefined;
    if (!src) return null;
    const orders: string[] = [];
    r.diagrams.forEach((d) => orders.push(d.get('order') as string));
    const sorted = [...orders].sort();
    const next = sorted.find((o) => o > src.order) ?? null;
    const idMap = new Map(Object.keys(src.elements).map((id) => [id, newId()]));
    const layerMap = new Map(Object.keys(src.layers).map((id) => [id, newId()]));
    const copy: Diagram = {
      id: newId(),
      name: `${src.name} copy`,
      order: keyBetween(src.order, next),
      layers: Object.fromEntries(
        Object.values(src.layers).map((l) => [layerMap.get(l.id)!, { ...l, id: layerMap.get(l.id)! }]),
      ),
      elements: {},
    };
    for (const el of Object.values(src.elements)) {
      const ne = { ...el, id: idMap.get(el.id)!, layerId: layerMap.get(el.layerId)!, mdl: undefined } as DiagramElement;
      if (ne.type === 'variable') ne.isShadow = true;
      if (ne.type === 'link') {
        ne.from = idMap.get(ne.from)!;
        ne.to = idMap.get(ne.to)!;
      }
      copy.elements[ne.id] = ne;
    }
    r.diagrams.set(copy.id, diagramToY(copy));
    return copy.id;
  });
}

// ---------------------------------------------------------------- layers

export function addLayer(doc: Y.Doc, diagramId: string, name: string, origin?: unknown): string {
  return run(doc, origin, () => {
    const layers = getLayersY(doc, diagramId);
    if (!layers) throw new Error('Unknown diagram');
    const orders: string[] = [];
    layers.forEach((l) => orders.push(l.get('order') as string));
    const layer: Layer = { id: newId(), name, order: keyAfter(orders), visible: true, locked: false };
    layers.set(layer.id, layerToY(layer));
    return layer.id;
  });
}

export function updateLayer(
  doc: Y.Doc,
  diagramId: string,
  layerId: string,
  patch: Partial<Omit<Layer, 'id'>>,
  origin?: unknown,
): void {
  run(doc, origin, () => {
    const l = getLayersY(doc, diagramId)?.get(layerId);
    if (!l) return;
    for (const [k, v] of Object.entries(patch)) l.set(k, v);
  });
}

/** Delete a layer; its elements move to `moveTo` or are deleted when it is null. */
export function deleteLayer(
  doc: Y.Doc,
  diagramId: string,
  layerId: string,
  moveTo: string | null,
  origin?: unknown,
): boolean {
  return run(doc, origin, () => {
    const layers = getLayersY(doc, diagramId);
    const els = getElementsY(doc, diagramId);
    if (!layers || !els || layers.size <= 1 || !layers.has(layerId)) return false;
    const ids: string[] = [];
    els.forEach((el, id) => {
      if (el.get('layerId') === layerId) ids.push(id);
    });
    if (moveTo && layers.has(moveTo)) {
      for (const id of ids) els.get(id)?.set('layerId', moveTo);
    } else {
      deleteElements(doc, diagramId, ids);
    }
    layers.delete(layerId);
    return true;
  });
}

// ---------------------------------------------------------------- variables

export function findVariableByName(doc: Y.Doc, name: string): string | undefined {
  const n = normName(name);
  let found: string | undefined;
  roots(doc).variables.forEach((v, id) => {
    if (!found && normName(v.get('name') as string) === n) found = id;
  });
  return found;
}

function hasPrimaryNode(doc: Y.Doc, variableId: string): boolean {
  let found = false;
  roots(doc).diagrams.forEach((d) => {
    (d.get('elements') as Y.Map<YMap>).forEach((el) => {
      if (el.get('type') === 'variable' && el.get('variableId') === variableId && !el.get('isShadow')) found = true;
    });
  });
  return found;
}

export interface AddVariableOptions {
  name: string;
  x: number;
  y: number;
  layerId: string;
  w?: number;
  h?: number;
  form?: NodeForm;
  style?: Style;
}

/**
 * Place a variable. If a variable with the same name exists the new node references it
 * (and becomes a shadow when the variable already has a primary node).
 */
export function addVariableNode(doc: Y.Doc, diagramId: string, opts: AddVariableOptions, origin?: unknown): string {
  return run(doc, origin, () => {
    const r = roots(doc);
    const els = requireElements(doc, diagramId);
    let variableId = findVariableByName(doc, opts.name);
    let isShadow = false;
    if (variableId) {
      isShadow = hasPrimaryNode(doc, variableId);
      const v = r.variables.get(variableId)!;
      const mdl = v.get('mdl') as Variable['mdl'];
      if (mdl?.unplaced) v.set('mdl', { ...mdl, unplaced: undefined });
    } else {
      variableId = newId();
      r.variables.set(variableId, variableToY({ id: variableId, name: opts.name.trim() }));
    }
    const node: VariableNode = {
      id: newId(),
      type: 'variable',
      layerId: opts.layerId,
      z: keyAfter(zKeysInLayer(els, opts.layerId)),
      variableId,
      x: Math.round(opts.x),
      y: Math.round(opts.y),
      w: opts.w ?? 100,
      h: opts.h ?? 40,
      form: opts.form ?? 'none',
      ...(isShadow ? { isShadow } : {}),
      ...(opts.style ? { style: opts.style } : {}),
    };
    els.set(node.id, elementToY(node));
    return node.id;
  });
}

export type RenameResult = { ok: true } | { ok: false; reason: 'empty' | 'duplicate' };

export function renameVariable(doc: Y.Doc, variableId: string, name: string, origin?: unknown): RenameResult {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: false, reason: 'empty' };
  const existing = findVariableByName(doc, trimmed);
  if (existing && existing !== variableId) return { ok: false, reason: 'duplicate' };
  run(doc, origin, () => roots(doc).variables.get(variableId)?.set('name', trimmed));
  return { ok: true };
}

export function updateVariable(
  doc: Y.Doc,
  variableId: string,
  patch: Partial<Pick<Variable, 'units' | 'notes'>>,
  origin?: unknown,
): void {
  run(doc, origin, () => {
    const v = roots(doc).variables.get(variableId);
    if (!v) return;
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined || val === '') v.delete(k);
      else v.set(k, val);
    }
  });
}

// ---------------------------------------------------------------- elements

export function addElement(doc: Y.Doc, diagramId: string, el: NewElement, origin?: unknown): string {
  return run(doc, origin, () => {
    const els = requireElements(doc, diagramId);
    const full = { ...el, id: el.id ?? newId(), z: el.z ?? keyAfter(zKeysInLayer(els, el.layerId)) } as DiagramElement;
    els.set(full.id, elementToY(full));
    return full.id;
  });
}

/** Add several elements at once (paste / duplicate); keeps their relative z order. */
export function addElements(doc: Y.Doc, diagramId: string, list: NewElement[], origin?: unknown): string[] {
  return run(doc, origin, () => list.map((el) => addElement(doc, diagramId, el)));
}

/** Shallow patch of element fields. `undefined` deletes a key. Use `setStyle` for style. */
export function updateElement(
  doc: Y.Doc,
  diagramId: string,
  id: string,
  patch: Record<string, unknown>,
  origin?: unknown,
): void {
  run(doc, origin, () => {
    const el = getElementsY(doc, diagramId)?.get(id);
    if (!el) return;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'type' || k === 'style') continue;
      if (v === undefined) el.delete(k);
      else el.set(k, v);
    }
  });
}

/** Patch style props of many elements. `undefined` resets a prop to the theme default. */
export function setStyle(doc: Y.Doc, diagramId: string, ids: string[], patch: Style, origin?: unknown): void {
  run(doc, origin, () => {
    const els = getElementsY(doc, diagramId);
    if (!els) return;
    for (const id of ids) {
      const el = els.get(id);
      if (!el) continue;
      let style = el.get('style') as YMap | undefined;
      if (!style) {
        style = plainToYMap({});
        el.set('style', style);
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) style.delete(k);
        else style.set(k, v);
      }
    }
  });
}

export interface Move {
  id: string;
  dx: number;
  dy: number;
}

const getNum = (m: YMap, k: string) => m.get(k) as number;

/**
 * Move elements by a delta. Links between two moved nodes translate their arc control point;
 * links with one moved endpoint keep their relative bend so curves stay natural.
 */
export function moveElements(doc: Y.Doc, diagramId: string, moves: Move[], origin?: unknown): void {
  run(doc, origin, () => {
    const els = getElementsY(doc, diagramId);
    if (!els) return;
    const delta = new Map(moves.map((m) => [m.id, m]));
    const before = new Map<string, Point>();
    els.forEach((el, id) => {
      if (el.get('type') !== 'link') before.set(id, { x: getNum(el, 'x'), y: getNum(el, 'y') });
    });
    els.forEach((el, id) => {
      const m = delta.get(id);
      if (!m || el.get('type') === 'link') return;
      el.set('x', Math.round(getNum(el, 'x') + m.dx));
      el.set('y', Math.round(getNum(el, 'y') + m.dy));
    });
    els.forEach((el) => {
      if (el.get('type') !== 'link') return;
      const control = el.get('control') as Point | null;
      if (!control) return;
      const from = el.get('from') as string;
      const to = el.get('to') as string;
      const mf = delta.get(from);
      const mt = delta.get(to);
      if (!mf && !mt) return;
      const p0 = before.get(from);
      const p1 = before.get(to);
      if (!p0 || !p1) return;
      if (mf && mt && mf.dx === mt.dx && mf.dy === mt.dy) {
        el.set('control', { x: Math.round(control.x + mf.dx), y: Math.round(control.y + mf.dy) });
        return;
      }
      const bend = bendFor(p0, p1, control);
      const n0 = { x: p0.x + (mf?.dx ?? 0), y: p0.y + (mf?.dy ?? 0) };
      const n1 = { x: p1.x + (mt?.dx ?? 0), y: p1.y + (mt?.dy ?? 0) };
      const c = controlFromBend(n0, n1, bend);
      el.set('control', { x: Math.round(c.x), y: Math.round(c.y) });
    });
  });
}

/** Delete elements; cascades to attached links, detaches anchored comments and GCs orphan variables. */
export function deleteElements(doc: Y.Doc, diagramId: string, ids: string[], origin?: unknown): number {
  return run(doc, origin, () => {
    const els = getElementsY(doc, diagramId);
    if (!els) return 0;
    const del = new Set(ids.filter((id) => els.has(id)));
    els.forEach((el, id) => {
      if (el.get('type') === 'link' && (del.has(el.get('from') as string) || del.has(el.get('to') as string))) {
        del.add(id);
      }
    });
    const promote = new Set<string>();
    for (const id of del) {
      const el = els.get(id);
      if (el?.get('type') === 'variable' && !el.get('isShadow')) promote.add(el.get('variableId') as string);
    }
    // Detach comments anchored to deleted elements, keeping their position.
    roots(doc).comments.forEach((t) => {
      const eid = t.get('elementId') as string | undefined;
      if (!eid || !del.has(eid) || t.get('diagramId') !== diagramId) return;
      const el = els.get(eid);
      const ex = (el?.get('x') as number | undefined) ?? 0;
      const ey = (el?.get('y') as number | undefined) ?? 0;
      t.set('x', ex + (t.get('x') as number));
      t.set('y', ey + (t.get('y') as number));
      t.delete('elementId');
    });
    for (const id of del) els.delete(id);
    // Promote a shadow to primary when the primary node of a variable was deleted.
    for (const variableId of promote) {
      if (hasPrimaryNode(doc, variableId)) continue;
      let done = false;
      roots(doc).diagrams.forEach((d) => {
        (d.get('elements') as Y.Map<YMap>).forEach((el) => {
          if (!done && el.get('type') === 'variable' && el.get('variableId') === variableId) {
            el.delete('isShadow');
            done = true;
          }
        });
      });
    }
    collectGarbageVariables(doc);
    return del.size;
  });
}

export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';

export function reorderElements(doc: Y.Doc, diagramId: string, ids: string[], op: ZOrderOp, origin?: unknown): void {
  run(doc, origin, () => {
    const els = getElementsY(doc, diagramId);
    if (!els) return;
    const selected = new Set(ids);
    const byLayer = new Map<string, { id: string; z: string }[]>();
    els.forEach((el, id) => {
      const layer = el.get('layerId') as string;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push({ id, z: el.get('z') as string });
    });
    for (const list of byLayer.values()) {
      list.sort(byKey((e) => e.z));
      const sel = list.filter((e) => selected.has(e.id));
      if (sel.length === 0) continue;
      const rest = list.filter((e) => !selected.has(e.id));
      let insertAt: number;
      if (op === 'front') insertAt = rest.length;
      else if (op === 'back') insertAt = 0;
      else if (op === 'forward') {
        const lastIdx = list.findIndex((e) => e.id === sel[sel.length - 1]!.id);
        const nextOther = list.slice(lastIdx + 1).find((e) => !selected.has(e.id));
        insertAt = nextOther ? rest.indexOf(nextOther) + 1 : rest.length;
      } else {
        const firstIdx = list.findIndex((e) => e.id === sel[0]!.id);
        const prevOther = [...list.slice(0, firstIdx)].reverse().find((e) => !selected.has(e.id));
        insertAt = prevOther ? rest.indexOf(prevOther) : 0;
      }
      let lo = insertAt > 0 ? rest[insertAt - 1]!.z : null;
      const hi = insertAt < rest.length ? rest[insertAt]!.z : null;
      for (const e of sel) {
        // Equal neighbour keys (concurrent inserts) can't be split; fall back to appending.
        const z = lo !== null && hi !== null && lo >= hi ? keyAfter([lo]) : keyBetween(lo, hi);
        els.get(e.id)!.set('z', z);
        lo = z;
      }
    }
  });
}

export function moveToLayer(doc: Y.Doc, diagramId: string, ids: string[], layerId: string, origin?: unknown): void {
  run(doc, origin, () => {
    const els = getElementsY(doc, diagramId);
    if (!els) return;
    const keys = zKeysInLayer(els, layerId);
    for (const id of ids) {
      const el = els.get(id);
      if (!el || el.get('layerId') === layerId) continue;
      const z = keyAfter(keys);
      keys.push(z);
      el.set('layerId', layerId);
      el.set('z', z);
    }
  });
}

/** Snapshot of selected elements for copy/paste, including links fully inside the selection. */
export function copyElements(doc: Y.Doc, diagramId: string, ids: string[]): DiagramElement[] {
  const els = getElementsY(doc, diagramId);
  if (!els) return [];
  const sel = new Set(ids);
  const out: DiagramElement[] = [];
  els.forEach((el, id) => {
    const json = el.toJSON() as DiagramElement;
    if (json.type === 'link') {
      if (sel.has(json.from) && sel.has(json.to)) out.push(json);
    } else if (sel.has(id)) out.push(json);
  });
  return out.sort(byKey((e) => e.z));
}

/**
 * Paste copied elements into a diagram on `layerId`, offset by (dx, dy).
 * Variables of the same project are reused (shadow if needed); names from other projects are created.
 */
export function pasteElements(
  doc: Y.Doc,
  diagramId: string,
  items: (DiagramElement & { variableName?: string })[],
  layerId: string,
  dx: number,
  dy: number,
  origin?: unknown,
): string[] {
  return run(doc, origin, () => {
    const r = roots(doc);
    const idMap = new Map<string, string>();
    const created: string[] = [];
    for (const item of items) {
      if (item.type === 'link') continue;
      if (item.type === 'variable') {
        const name = item.variableName ?? (r.variables.get(item.variableId)?.get('name') as string | undefined);
        if (!name) continue;
        const id = addVariableNode(doc, diagramId, {
          name,
          x: item.x + dx,
          y: item.y + dy,
          layerId,
          w: item.w,
          h: item.h,
          form: item.form,
          style: item.style,
        });
        idMap.set(item.id, id);
        created.push(id);
      } else {
        const { id: oldId, z: _z, mdl: _m, ...rest } = item;
        const id = addElement(doc, diagramId, { ...rest, layerId, x: item.x + dx, y: item.y + dy } as NewElement);
        idMap.set(oldId, id);
        created.push(id);
      }
    }
    for (const item of items) {
      if (item.type !== 'link') continue;
      const from = idMap.get(item.from);
      const to = idMap.get(item.to);
      if (!from || !to) continue;
      const { id: _id, z: _z, mdl: _m, ...rest } = item;
      const id = addElement(doc, diagramId, {
        ...rest,
        layerId,
        from,
        to,
        control: item.control ? { x: item.control.x + dx, y: item.control.y + dy } : null,
      } as NewElement);
      created.push(id);
    }
    return created;
  });
}

// ---------------------------------------------------------------- comments

export function addThread(
  doc: Y.Doc,
  thread: Omit<CommentThread, 'id' | 'messages' | 'resolved'> & { body: string; authorName: string },
  origin?: unknown,
): string {
  return run(doc, origin, () => {
    const { body, authorName, ...rest } = thread;
    const id = newId();
    const msg: CommentMessage = { id: newId(), authorId: rest.createdBy, authorName, body, createdAt: rest.createdAt };
    roots(doc).comments.set(id, threadToY({ ...rest, id, resolved: false, messages: [msg] }));
    return id;
  });
}

export function addMessage(
  doc: Y.Doc,
  threadId: string,
  msg: Omit<CommentMessage, 'id'>,
  origin?: unknown,
): string | null {
  return run(doc, origin, () => {
    const t = roots(doc).comments.get(threadId);
    if (!t) return null;
    const id = newId();
    (t.get('messages') as Y.Array<unknown>).push([{ ...msg, id }]);
    return id;
  });
}

export function setThreadResolved(doc: Y.Doc, threadId: string, resolved: boolean, origin?: unknown): void {
  run(doc, origin, () => roots(doc).comments.get(threadId)?.set('resolved', resolved));
}

export function moveThread(doc: Y.Doc, threadId: string, x: number, y: number, origin?: unknown): void {
  run(doc, origin, () => {
    const t = roots(doc).comments.get(threadId);
    t?.set('x', Math.round(x));
    t?.set('y', Math.round(y));
  });
}

export function deleteThread(doc: Y.Doc, threadId: string, origin?: unknown): void {
  run(doc, origin, () => roots(doc).comments.delete(threadId));
}

export function getMessage(doc: Y.Doc, threadId: string, messageId: string): CommentMessage | undefined {
  const arr = roots(doc).comments.get(threadId)?.get('messages') as Y.Array<CommentMessage> | undefined;
  return arr?.toArray().find((m) => m.id === messageId);
}

/** Edit (body set) or delete (body null) a message. Deleting the first message deletes the thread. */
export function editMessage(
  doc: Y.Doc,
  threadId: string,
  messageId: string,
  body: string | null,
  origin?: unknown,
): void {
  run(doc, origin, () => {
    const t = roots(doc).comments.get(threadId);
    const arr = t?.get('messages') as Y.Array<CommentMessage> | undefined;
    if (!t || !arr) return;
    const idx = arr.toArray().findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    if (body === null) {
      if (idx === 0) roots(doc).comments.delete(threadId);
      else arr.delete(idx, 1);
      return;
    }
    const old = arr.get(idx);
    arr.delete(idx, 1);
    arr.insert(idx, [{ ...old, body, editedAt: Date.now() }]);
  });
}

// ---------------------------------------------------------------- invariants

/** Remove variables no node references any more. */
export function collectGarbageVariables(doc: Y.Doc): void {
  const r = roots(doc);
  const used = new Set<string>();
  r.diagrams.forEach((d) => {
    (d.get('elements') as Y.Map<YMap>).forEach((el) => {
      if (el.get('type') === 'variable') used.add(el.get('variableId') as string);
    });
  });
  r.variables.forEach((v, id) => {
    // Variables imported from .mdl that were never placed in a view are kept (they carry equations).
    if (!used.has(id) && !(v.get('mdl') as Variable['mdl'])?.unplaced) r.variables.delete(id);
  });
}

/**
 * Restore invariants that concurrent edits can break (e.g. a link drawn to a node another user
 * deleted). Deterministic and idempotent so every client converges; only writes when needed.
 */
export function repairDoc(doc: Y.Doc, origin: unknown = 'repair'): boolean {
  let changed = false;
  run(doc, origin, () => {
    const r = roots(doc);
    // 1. Duplicate variable names (created concurrently): merge into the smallest id.
    const byName = new Map<string, string[]>();
    r.variables.forEach((v, id) => {
      const n = normName((v.get('name') as string) ?? '');
      byName.set(n, [...(byName.get(n) ?? []), id]);
    });
    const remap = new Map<string, string>();
    for (const ids of byName.values()) {
      if (ids.length < 2) continue;
      ids.sort();
      for (const id of ids.slice(1)) remap.set(id, ids[0]!);
    }
    for (const [from] of remap) {
      r.variables.delete(from);
      changed = true;
    }
    if (r.diagrams.size === 0) {
      const d = newDiagram('Main', keyAfter([]));
      r.diagrams.set(d.id, diagramToY(d));
      changed = true;
    }
    r.diagrams.forEach((d) => {
      const layers = d.get('layers') as Y.Map<YMap>;
      const els = d.get('elements') as Y.Map<YMap>;
      if (layers.size === 0) {
        const l: Layer = { id: newId(), name: 'Base', order: keyAfter([]), visible: true, locked: false };
        layers.set(l.id, layerToY(l));
        changed = true;
      }
      const layerIds = [...layers.keys()].sort((a, b) => {
        const oa = layers.get(a)!.get('order') as string;
        const ob = layers.get(b)!.get('order') as string;
        return oa < ob ? -1 : oa > ob ? 1 : a < b ? -1 : 1;
      });
      const toDelete: string[] = [];
      els.forEach((el, id) => {
        if (!layers.has(el.get('layerId') as string)) {
          el.set('layerId', layerIds[0]!);
          changed = true;
        }
        if (el.get('type') === 'variable') {
          const vid = el.get('variableId') as string;
          const target = remap.get(vid);
          if (target) {
            el.set('variableId', target);
            changed = true;
          } else if (!r.variables.has(vid)) toDelete.push(id);
        }
      });
      for (const id of toDelete) els.delete(id);
      const dangling: string[] = [];
      els.forEach((el, id) => {
        if (el.get('type') !== 'link') return;
        const from = els.get(el.get('from') as string);
        const to = els.get(el.get('to') as string);
        if (!from || !to || from.get('type') !== 'variable' || to.get('type') !== 'variable') dangling.push(id);
      });
      for (const id of dangling) els.delete(id);
      if (toDelete.length || dangling.length) changed = true;
    });
  });
  return changed;
}

