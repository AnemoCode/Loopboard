import { toast } from 'sonner';
import {
  addElement,
  copyElements,
  deleteElements,
  findLoops,
  freeSpotNear,
  moveElements,
  pasteElements,
  reorderElements,
  setStyle,
  updateElement,
  type DiagramElement,
  type Link,
  type Polarity,
  type Style,
  type ZOrderOp,
} from '@cld/model';
import type { Box, DiagramLayout } from '@cld/render';
import type { EditorCtx } from './context';
import { LOCAL } from './session';
import { editor, useEditor, type Viewport } from './store';

/** Editor actions shared by shortcuts, menus, toolbar and inspector. All edits use the LOCAL origin (undoable). */

const current = (ctx: EditorCtx) => {
  const { diagramId } = editor();
  const view = ctx.store.get();
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  return { diagramId: diagramId!, diagram, view };
};

const selectedElements = (ctx: EditorCtx): DiagramElement[] => {
  const { diagram } = current(ctx);
  return editor()
    .selection.map((id) => diagram?.elements[id])
    .filter((e): e is DiagramElement => !!e);
};

/** Elements that may be changed: not locked themselves and not on a locked layer. */
export function editable(ctx: EditorCtx, ids: string[]): string[] {
  const { diagram } = current(ctx);
  if (!diagram || !ctx.canEdit) return [];
  return ids.filter((id) => {
    const el = diagram.elements[id];
    return el && !el.locked && !diagram.layers[el.layerId]?.locked;
  });
}

export function deleteSelection(ctx: EditorCtx) {
  const ids = editable(ctx, editor().selection);
  if (!ids.length) return;
  const n = deleteElements(ctx.session.doc, current(ctx).diagramId, ids, LOCAL);
  useEditor.getState().select([]);
  if (n > ids.length) toast(`Deleted ${n} elements (including attached links)`, { action: { label: 'Undo', onClick: () => ctx.session.undo.undo() } });
}

export function nudge(ctx: EditorCtx, dx: number, dy: number) {
  const ids = editable(ctx, editor().selection);
  if (ids.length) moveElements(ctx.session.doc, current(ctx).diagramId, ids.map((id) => ({ id, dx, dy })), LOCAL);
}

export function setPolarity(ctx: EditorCtx, polarity: Polarity | 'cycle') {
  const links = selectedElements(ctx).filter((e): e is Link => e.type === 'link' && editable(ctx, [e.id]).length > 0);
  if (!links.length) return false;
  const order: Polarity[] = ['+', '-', '?', null];
  for (const l of links) {
    const next = polarity === 'cycle' ? order[(order.indexOf(l.polarity) + 1) % order.length]! : polarity;
    updateElement(ctx.session.doc, current(ctx).diagramId, l.id, { polarity: next }, LOCAL);
  }
  return true;
}

export function toggleDelay(ctx: EditorCtx) {
  const links = selectedElements(ctx).filter((e): e is Link => e.type === 'link');
  if (!links.length) return;
  const on = !links.every((l) => l.delay);
  for (const l of editable(ctx, links.map((x) => x.id))) updateElement(ctx.session.doc, current(ctx).diagramId, l, { delay: on || undefined }, LOCAL);
}

export function applyStyle(ctx: EditorCtx, ids: string[], patch: Style) {
  const ok = editable(ctx, ids);
  if (ok.length) setStyle(ctx.session.doc, current(ctx).diagramId, ok, patch, LOCAL);
}

export function patchElements(ctx: EditorCtx, ids: string[], patch: Record<string, unknown>) {
  for (const id of editable(ctx, ids)) updateElement(ctx.session.doc, current(ctx).diagramId, id, patch, LOCAL);
}

export function reorder(ctx: EditorCtx, op: ZOrderOp) {
  const ids = editable(ctx, editor().selection);
  if (ids.length) reorderElements(ctx.session.doc, current(ctx).diagramId, ids, op, LOCAL);
}

// ---------------------------------------------------------------- clipboard

const CLIP_TYPE = 'loopwise/elements';
let pasteCount = 0;

export function copyPayload(ctx: EditorCtx): string | null {
  const { diagramId, view } = current(ctx);
  const items = copyElements(ctx.session.doc, diagramId, editor().selection).map((el) =>
    el.type === 'variable' ? { ...el, variableName: view.variables[el.variableId]?.name } : el,
  );
  if (!items.length) return null;
  pasteCount = 0;
  return JSON.stringify({ type: CLIP_TYPE, items });
}

export function pastePayload(ctx: EditorCtx, text: string): boolean {
  let data: { type?: string; items?: (DiagramElement & { variableName?: string })[] };
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (data.type !== CLIP_TYPE || !Array.isArray(data.items) || !ctx.canEdit) return false;
  const { layerId } = editor();
  if (!layerId) return false;
  pasteCount++;
  const offset = 24 * pasteCount;
  const ids = pasteElements(ctx.session.doc, current(ctx).diagramId, data.items, layerId, offset, offset, LOCAL);
  useEditor.getState().select(ids);
  return true;
}

export function duplicateSelection(ctx: EditorCtx) {
  const payload = copyPayload(ctx);
  if (payload) pastePayload(ctx, payload);
}

// ---------------------------------------------------------------- loops

/** Place a loop marker for a detected loop (auto-numbered R1, B2, …). */
export function placeLoopMarker(ctx: EditorCtx, loop: ReturnType<typeof findLoops>['loops'][number]) {
  const { diagram, diagramId } = current(ctx);
  const { layerId } = editor();
  if (!diagram || !layerId || !ctx.canEdit) return;
  const kind = loop.kind === '?' ? 'custom' : loop.kind;
  const prefix = kind === 'custom' ? 'L' : kind;
  const used = Object.values(diagram.elements).filter((e) => e.type === 'loop' && e.label.startsWith(prefix)).length;
  const at = freeSpotNear(diagram, loop.center);
  const id = addElement(
    ctx.session.doc,
    diagramId,
    { type: 'loop', layerId, x: at.x, y: at.y, r: 26, kind, label: `${prefix}${used + 1}`, direction: loop.direction },
    LOCAL,
  );
  useEditor.getState().select([id]);
}

export function nextLoopLabel(ctx: EditorCtx, kind: 'R' | 'B'): string {
  const { diagram } = current(ctx);
  const used = Object.values(diagram?.elements ?? {}).filter((e) => e.type === 'loop' && e.label.startsWith(kind)).length;
  return `${kind}${used + 1}`;
}

// ---------------------------------------------------------------- viewport

export function zoomTo(viewport: Viewport, zoom: number, center: { x: number; y: number }): Viewport {
  const z = Math.min(4, Math.max(0.1, zoom));
  const wx = (center.x - viewport.x) / viewport.zoom;
  const wy = (center.y - viewport.y) / viewport.zoom;
  return { zoom: z, x: center.x - wx * z, y: center.y - wy * z };
}

export function fitBox(box: Box | null, width: number, height: number, maxZoom = 1.5): Viewport {
  if (!box || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, zoom: 1 };
  const pad = 64;
  const zoom = Math.min(maxZoom, Math.max(0.1, Math.min((width - pad * 2) / Math.max(box.w, 1), (height - pad * 2) / Math.max(box.h, 1))));
  return { zoom, x: width / 2 - (box.x + box.w / 2) * zoom, y: height / 2 - (box.y + box.h / 2) * zoom };
}

export function selectionBox(layout: DiagramLayout, ids: string[]): Box | null {
  const boxes = ids.map((id) => layout.byId.get(id)?.bbox).filter((b): b is Box => !!b);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
