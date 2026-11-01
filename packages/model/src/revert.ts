import * as Y from 'yjs';
import { ABSENT, type ChangeOp } from './changes.js';
import { deleteDiagram, deleteElements, deleteLayer, repairDoc } from './commands.js';
import {
  diagramToY,
  elementToY,
  layerToY,
  plainToYMap,
  roots,
  threadToY,
  variableToY,
  type YMap,
} from './doc.js';
import type { CommentThread, Diagram, DiagramElement, Layer, Variable } from './types.js';

export interface RevertResult {
  /** Ops that were undone. */
  applied: number;
  /** Ops left alone because the object changed again later (or no longer exists). */
  skipped: number;
}

const json = (v: unknown) => JSON.stringify(v ?? null);
const isAbsent = (v: unknown) =>
  !!v && typeof v === 'object' && (v as { $absent?: boolean }).$absent === true;

/** Resolve an op path to its Y.Map (or undefined). */
function locate(doc: Y.Doc, path: string[]): YMap | undefined {
  const r = roots(doc);
  const [root, id, sub, subId, leaf] = path;
  if (root === 'variables') return r.variables.get(id!);
  if (root === 'comments') return r.comments.get(id!);
  if (root !== 'diagrams') return undefined;
  const d = r.diagrams.get(id!);
  if (!sub) return d;
  const child = (d?.get(sub) as Y.Map<YMap> | undefined)?.get(subId!);
  if (!leaf) return child;
  return child?.get(leaf) as YMap | undefined;
}

/** Current value of a key, in the snapshot representation (nested maps/arrays as JSON). */
function current(map: YMap, key: string): unknown {
  const v = map.get(key);
  if (v === undefined) return ABSENT;
  if (v instanceof Y.AbstractType) return v.toJSON();
  return v;
}

function setValue(map: YMap, key: string, value: unknown) {
  if (isAbsent(value)) {
    map.delete(key);
    return;
  }
  const existing = map.get(key);
  if (existing instanceof Y.Array) {
    existing.delete(0, existing.length);
    existing.push(value as unknown[]);
  } else if (key === 'style' && value && typeof value === 'object') {
    map.set(key, plainToYMap(value));
  } else map.set(key, value);
}

/** Recreate a deleted object at `path`. Returns false if something else now exists there or its parent is gone. */
function recreate(doc: Y.Doc, path: string[], value: unknown): boolean {
  const r = roots(doc);
  const [root, id, sub, subId] = path;
  const existing = locate(doc, path);
  // Already there: fine if it is exactly what we'd restore (e.g. recreated together with a parent).
  if (existing) return json(existing.toJSON()) === json(value);
  if (root === 'variables') r.variables.set(id!, variableToY(value as Variable));
  else if (root === 'comments') r.comments.set(id!, threadToY(value as CommentThread));
  else if (root === 'diagrams' && !sub) r.diagrams.set(id!, diagramToY(value as Diagram));
  else if (root === 'diagrams') {
    const parent = r.diagrams.get(id!)?.get(sub!) as Y.Map<YMap> | undefined;
    if (!parent) return false;
    parent.set(
      subId!,
      sub === 'layers' ? layerToY(value as Layer) : elementToY(value as DiagramElement),
    );
  } else return false;
  return true;
}

/** Delete an object that the change had created. */
function remove(doc: Y.Doc, path: string[]): boolean {
  const r = roots(doc);
  const [root, id, sub, subId] = path;
  if (!locate(doc, path)) return true; // already gone (e.g. removed with its node)
  if (root === 'variables') {
    // Only if no node uses it any more (nodes are removed by their own ops first).
    let used = false;
    r.diagrams.forEach((d) =>
      (d.get('elements') as Y.Map<YMap>).forEach((el) => {
        if (el.get('variableId') === id) used = true;
      }),
    );
    if (used) return false;
    r.variables.delete(id!);
  } else if (root === 'comments') r.comments.delete(id!);
  else if (root === 'diagrams' && !sub) return deleteDiagram(doc, id!);
  else if (sub === 'layers') {
    const layers = r.diagrams.get(id!)?.get('layers') as Y.Map<YMap>;
    const other = [...layers.keys()].find((k) => k !== subId) ?? null;
    return deleteLayer(doc, id!, subId!, other);
  } else deleteElements(doc, id!, [subId!]);
  return true;
}

/** Order so that parents exist before children are recreated, and children go before parents are removed. */
function rank(op: ChangeOp): number {
  const [root, , sub, , leaf] = op.path;
  const recreating = op.t === 'put' && op.after === null;
  const depth =
    root === 'variables'
      ? 0
      : root === 'diagrams' && !sub
        ? 1
        : sub === 'layers'
          ? 2
          : sub === 'elements' && !leaf
            ? isLink(op)
              ? 4
              : 3
            : root === 'comments'
              ? 5
              : 6;
  return recreating ? depth : op.t === 'put' ? 10 - depth : 20;
}
const isLink = (op: ChangeOp) =>
  op.t === 'put' && ((op.before ?? op.after) as { type?: string } | null)?.type === 'link';

/**
 * Undo a recorded change. Fields are only reverted where they still hold the value the change set
 * (so later edits by others are never overwritten); deleted objects are recreated if absent;
 * created objects are removed.
 */
export function revertOps(doc: Y.Doc, ops: ChangeOp[], origin?: unknown): RevertResult {
  const result: RevertResult = { applied: 0, skipped: 0 };
  doc.transact(() => {
    for (const op of [...ops].sort((a, b) => rank(a) - rank(b))) {
      if (op.t === 'put') {
        const ok = op.after === null ? recreate(doc, op.path, op.before) : remove(doc, op.path);
        result[ok ? 'applied' : 'skipped']++;
        continue;
      }
      let map = locate(doc, op.path);
      if (!map && op.path[4] === 'style') {
        const el = locate(doc, op.path.slice(0, 4));
        if (el && Object.values(op.after).every(isAbsent)) {
          map = plainToYMap({});
          el.set('style', map);
        }
      }
      if (!map) {
        result.skipped++;
        continue;
      }
      const unchanged = Object.keys(op.after).every(
        (k) =>
          json(current(map, k)) === json(op.after[k]) ||
          (isAbsent(op.after[k]) && isAbsent(current(map, k))),
      );
      if (!unchanged) {
        result.skipped++;
        continue;
      }
      for (const [k, v] of Object.entries(op.before)) setValue(map, k, v);
      // An emptied style map is the same as no style at all.
      if (op.path[4] === 'style' && map.size === 0)
        locate(doc, op.path.slice(0, 4))?.delete('style');
      result.applied++;
    }
    repairDoc(doc);
  }, origin);
  return result;
}
