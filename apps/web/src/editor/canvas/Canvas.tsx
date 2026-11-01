import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import {
  addElement,
  moveElements,
  updateElement,
  type DiagramElement,
  type Point,
} from '@cld/model';
import {
  darkTheme,
  layoutDiagram,
  LayoutCache,
  lightTheme,
  type Box,
  type DiagramLayout,
} from '@cld/render';
import { useIsDark } from '../../lib/theme';
import { editable, fitBox, nextLoopLabel, zoomTo } from '../actions';
import { useEditorCtx } from '../context';
import { useDocView } from '../docView';
import { createPresencePublisher, type Peer } from '../presence';
import { LOCAL } from '../session';
import { editor, useEditor } from '../store';
import { useShortcuts } from '../useShortcuts';
import { CanvasOverlay } from './CanvasOverlay';
import {
  applyGesture,
  boxContains,
  boxesIntersect,
  handlePoint,
  handlesFor,
  resizeBox,
  resizeTo,
  snapMove,
  type Handle,
} from './gestures';
import { ElementView } from './PrimView';

const DRAG_THRESHOLD = 3;

type Pending =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | {
      kind: 'press';
      id: string;
      start: Point;
      sx: number;
      sy: number;
      wasSelected: boolean;
      shift: boolean;
    }
  | { kind: 'move'; ids: string[]; start: Point; box: Box | null; others: Box[] }
  | { kind: 'resize'; id: string; handle: Handle; box: Box }
  | { kind: 'curve'; id: string }
  | { kind: 'link'; from: string; linkId?: string; end?: 'from' | 'to' }
  | { kind: 'marquee'; start: Point; base: string[]; contain: boolean }
  | { kind: 'draw'; start: Point };

export function Canvas({ peers }: { peers: Peer[] }) {
  const ctx = useEditorCtx();
  const { session, store, canEdit } = ctx;
  const view = useDocView(store);
  const dark = useIsDark();
  const theme = dark ? darkTheme : lightTheme;
  const { diagramId, viewport, gesture, selection, tool, editing, highlight, guides } = useEditor();
  const set = useEditor((s) => s.set);
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cache = useRef(new LayoutCache());
  const pending = useRef<Pending | null>(null);
  const space = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const publish = useMemo(() => createPresencePublisher(session), [session]);

  // ---- derived scene: document + local gesture + collaborators' live gestures
  const localPeers = useMemo(
    () => peers.filter((p) => p.diagramId === diagramId),
    [peers, diagramId],
  );
  const elements = useMemo(() => {
    let els = diagram?.elements ?? {};
    for (const p of localPeers) els = applyGesture(els, p.gesture);
    return applyGesture(els, gesture);
  }, [diagram, localPeers, gesture]);
  const layers = useMemo(() => diagram?.layers ?? {}, [diagram]);
  const variableName = useCallback(
    (id: string) => view.variables[id]?.name ?? '',
    [view.variables],
  );
  const layout: DiagramLayout = useMemo(
    () => layoutDiagram({ elements, layers, variableName }, theme, cache.current),
    [elements, layers, variableName, theme],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // ---- size + initial fit per diagram
  useLayoutEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!diagramId || !size.w || fitted.current === diagramId) return;
    fitted.current = diagramId;
    set({ viewport: fitBox(layoutRef.current.bbox, size.w, size.h, 1) });
  }, [diagramId, size.w, size.h, set]);
  const fitNonce = useEditor((s) => s.fitNonce);
  useEffect(() => {
    if (fitNonce)
      set({
        viewport: fitBox(layoutRef.current.bbox, sizeRef.current.w, sizeRef.current.h, 1.5),
        followClientId: null,
      });
  }, [fitNonce, set]);

  // ---- keyboard shortcuts + clipboard
  const getLayout = useCallback(() => layoutRef.current, []);
  const getSize = useCallback(() => sizeRef.current, []);
  useShortcuts(ctx, getLayout, getSize);

  // ---- follow mode: keep the followed collaborator's view centred
  const followClientId = useEditor((s) => s.followClientId);
  const followed =
    followClientId !== null ? peers.find((p) => p.clientId === followClientId) : undefined;
  useEffect(() => {
    if (followClientId === null) return;
    if (!followed) {
      set({ followClientId: null });
      return;
    }
    if (followed.diagramId && followed.diagramId !== editor().diagramId)
      set({ diagramId: followed.diagramId, selection: [] });
    const v = followed.viewport;
    if (v && size.w) set({ viewport: fitBox(v, size.w, size.h, 4) });
  }, [followClientId, followed, size.w, size.h, set]);

  // ---- presence publishing
  useEffect(() => publish({ selection }), [selection, publish]);
  useEffect(
    () =>
      publish({
        gesture:
          gesture && (gesture.kind === 'marquee' || gesture.kind === 'draw') ? null : gesture,
      }),
    [gesture, publish],
  );
  useEffect(() => publish({ diagramId, cursor: null }, true), [diagramId, publish]);
  useEffect(() => {
    if (!size.w) return;
    publish({
      viewport: {
        x: -viewport.x / viewport.zoom,
        y: -viewport.y / viewport.zoom,
        w: size.w / viewport.zoom,
        h: size.h / viewport.zoom,
      },
    });
  }, [viewport, size, publish]);
  useEffect(
    () => publish({ editing: editing?.kind === 'element' ? editing.id : null }),
    [editing, publish],
  );

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    const v = editor().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  // ---- wheel: pan, ctrl/cmd + wheel (and pinch) zooms around the pointer
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = editor().viewport;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(
          -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 2.5 : 1),
        );
        set({
          viewport: zoomTo(v, v.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top }),
          followClientId: null,
        });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        set({ viewport: { ...v, x: v.x - dx, y: v.y - dy }, followClientId: null });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [set]);

  // ---- space-to-pan
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        space.current = true;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false;
        if (containerRef.current) containerRef.current.style.cursor = '';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const variableAt = (clientX: number, clientY: number): string | null => {
    const hit = document
      .elementFromPoint(clientX, clientY)
      ?.closest('[data-id]')
      ?.getAttribute('data-id');
    return hit && elementsRef.current[hit]?.type === 'variable' ? hit : null;
  };

  const finishTool = () => set({ tool: 'select' });

  // ---- pointer interaction
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as Element;
    if (target.closest('[data-overlay]')) return;
    const st = editor();
    if (st.editing) (document.activeElement as HTMLElement | null)?.blur();
    const world = toWorld(e.clientX, e.clientY);
    svgRef.current?.setPointerCapture(e.pointerId);

    if (e.button === 1 || space.current || st.tool === 'hand') {
      pending.current = {
        kind: 'pan',
        sx: e.clientX,
        sy: e.clientY,
        vx: st.viewport.x,
        vy: st.viewport.y,
      };
      set({ followClientId: null });
      return;
    }
    const id = target.closest('[data-id]')?.getAttribute('data-id') ?? null;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') ?? null;
    const connector = target.closest('[data-connector]')?.getAttribute('data-connector') ?? null;
    const el = id ? elementsRef.current[id] : undefined;

    switch (st.tool) {
      case 'variable':
        if (!canEdit) return;
        set({ editing: { kind: 'new-variable', x: world.x, y: world.y }, selection: [] });
        finishTool();
        return;
      case 'text':
        if (!canEdit) return;
        set({ editing: { kind: 'new-text', x: world.x, y: world.y }, selection: [] });
        finishTool();
        return;
      case 'loop': {
        if (!canEdit || !st.layerId) return;
        const newId = addElement(
          session.doc,
          st.diagramId!,
          {
            type: 'loop',
            layerId: st.layerId,
            x: Math.round(world.x),
            y: Math.round(world.y),
            r: 26,
            kind: 'R',
            label: nextLoopLabel(ctx, 'R'),
            direction: 'cw',
          },
          LOCAL,
        );
        set({ selection: [newId], panelTab: 'design', panelOpen: true });
        finishTool();
        return;
      }
      case 'shape':
        if (!canEdit) return;
        pending.current = { kind: 'draw', start: world };
        set({
          gesture: {
            kind: 'draw',
            shape: st.shapeKind,
            x0: world.x,
            y0: world.y,
            x1: world.x,
            y1: world.y,
          },
        });
        return;
      case 'comment': {
        if (!ctx.canComment) return;
        const anchor = el && el.type !== 'link' ? el : null;
        set({
          draftComment: anchor
            ? { elementId: anchor.id, x: world.x - anchor.x, y: world.y - anchor.y }
            : { x: world.x, y: world.y },
          openThread: null,
        });
        finishTool();
        return;
      }
      case 'link':
        if (canEdit && el?.type === 'variable') {
          pending.current = { kind: 'link', from: el.id };
          set({ gesture: { kind: 'link', from: el.id, point: world, target: null } });
        }
        return;
    }

    // Select tool
    if (handle && st.selection.length === 1 && canEdit) {
      const selId = st.selection[0]!;
      const sel = elementsRef.current[selId];
      const lay = layoutRef.current.byId.get(selId);
      if (sel && lay && editable(ctx, [selId]).length) {
        if (handle === 'curve' && sel.type === 'link') {
          pending.current = { kind: 'curve', id: selId };
          set({ gesture: { kind: 'curve', id: selId, control: sel.control ?? lay.link!.handle } });
        } else if ((handle === 'from' || handle === 'to') && sel.type === 'link') {
          const fixed = handle === 'from' ? sel.to : sel.from;
          pending.current = { kind: 'link', from: fixed, linkId: selId, end: handle };
          set({
            gesture: {
              kind: 'link',
              from: fixed,
              point: world,
              target: null,
              linkId: selId,
              end: handle,
            },
          });
        } else {
          const box = resizeBox(sel, lay.bbox);
          pending.current = { kind: 'resize', id: selId, handle: handle as Handle, box };
        }
        return;
      }
    }
    if (connector && canEdit) {
      pending.current = { kind: 'link', from: connector };
      set({ gesture: { kind: 'link', from: connector, point: world, target: null } });
      return;
    }
    if (id && el) {
      const wasSelected = st.selection.includes(id);
      if (e.shiftKey || e.metaKey)
        set({
          selection: wasSelected ? st.selection.filter((s) => s !== id) : [...st.selection, id],
        });
      else if (!wasSelected) set({ selection: [id] });
      pending.current = {
        kind: 'press',
        id,
        start: world,
        sx: e.clientX,
        sy: e.clientY,
        wasSelected,
        shift: e.shiftKey || e.metaKey,
      };
      return;
    }
    // Empty canvas: marquee selection.
    pending.current = {
      kind: 'marquee',
      start: world,
      base: e.shiftKey ? st.selection : [],
      contain: e.altKey,
    };
    if (!e.shiftKey) set({ selection: [], openThread: null });
    set({ gesture: { kind: 'marquee', x0: world.x, y0: world.y, x1: world.x, y1: world.y } });
  };

  const onPointerMove = (e: RPointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    publish({ cursor: { x: Math.round(world.x), y: Math.round(world.y) } });
    const p = pending.current;
    if (!p) return;
    const st = editor();
    switch (p.kind) {
      case 'pan':
        set({
          viewport: { ...st.viewport, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy },
        });
        return;
      case 'press': {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_THRESHOLD) return;
        const ids = editable(ctx, st.selection.includes(p.id) ? st.selection : [p.id]).filter(
          (i) => elementsRef.current[i]?.type !== 'link',
        );
        if (!ids.length) {
          pending.current = null;
          return;
        }
        const lay = layoutRef.current;
        const movingBoxes = ids.map((i) => lay.byId.get(i)?.bbox).filter((b): b is Box => !!b);
        const box = movingBoxes.length === 1 ? movingBoxes[0]! : null;
        const moving = new Set(ids);
        const others = box
          ? lay.order
              .filter((i) => !moving.has(i) && elementsRef.current[i]?.type !== 'link')
              .map((i) => lay.byId.get(i)!.bbox)
          : [];
        pending.current = { kind: 'move', ids, start: p.start, box, others };
        return onPointerMove(e);
      }
      case 'move': {
        let dx = world.x - p.start.x;
        let dy = world.y - p.start.y;
        let g: { x?: number; y?: number } | null = null;
        if (p.box && !e.altKey)
          ({ dx, dy, guides: g } = snapMove(p.box, p.others, dx, dy, 6 / st.viewport.zoom));
        set({
          gesture: { kind: 'move', ids: p.ids, dx: Math.round(dx), dy: Math.round(dy) },
          guides: g,
        });
        return;
      }
      case 'resize': {
        const el = diagram?.elements[p.id];
        if (!el) return;
        set({
          gesture: {
            kind: 'resize',
            id: p.id,
            ...resizeTo(el, p.box, p.handle, world, e.shiftKey),
          },
        });
        return;
      }
      case 'curve': {
        const link = diagram?.elements[p.id];
        if (link?.type !== 'link') return;
        const a = layoutRef.current.byId.get(link.from)?.boundary;
        const b = layoutRef.current.byId.get(link.to)?.boundary;
        // Snap back to a straight line near the chord.
        let control: Point | null = { x: Math.round(world.x), y: Math.round(world.y) };
        if (a && b) {
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const len = Math.hypot(dx, dy) || 1;
          const dist = Math.abs((world.x - a.cx) * dy - (world.y - a.cy) * dx) / len;
          if (dist < 6 / st.viewport.zoom) control = null;
        }
        set({ gesture: { kind: 'curve', id: p.id, control } });
        return;
      }
      case 'link': {
        const target = variableAt(e.clientX, e.clientY);
        set({
          gesture: {
            kind: 'link',
            from: p.from,
            point: world,
            target,
            linkId: p.linkId,
            end: p.end,
          },
        });
        return;
      }
      case 'marquee': {
        const g = {
          kind: 'marquee' as const,
          x0: p.start.x,
          y0: p.start.y,
          x1: world.x,
          y1: world.y,
        };
        const box = {
          x: Math.min(g.x0, g.x1),
          y: Math.min(g.y0, g.y1),
          w: Math.abs(g.x1 - g.x0),
          h: Math.abs(g.y1 - g.y0),
        };
        const lay = layoutRef.current;
        const hit = lay.order.filter((i) => {
          const b = lay.byId.get(i)!.bbox;
          return p.contain || e.altKey ? boxContains(box, b) : boxesIntersect(box, b);
        });
        set({ gesture: g, selection: [...new Set([...p.base, ...hit])] });
        return;
      }
      case 'draw':
        set({
          gesture: {
            kind: 'draw',
            shape: st.shapeKind,
            x0: p.start.x,
            y0: p.start.y,
            x1: world.x,
            y1: world.y,
          },
        });
        return;
    }
  };

  const onPointerUp = (e: RPointerEvent) => {
    const p = pending.current;
    pending.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    const st = editor();
    const g = st.gesture;
    const doc = session.doc;
    const dId = st.diagramId!;
    if (p?.kind === 'press' && p.wasSelected && !p.shift && st.selection.length > 1)
      set({ selection: [p.id] });
    if (p?.kind === 'move' && g?.kind === 'move' && (g.dx || g.dy)) {
      moveElements(
        doc,
        dId,
        g.ids.map((id) => ({ id, dx: g.dx, dy: g.dy })),
        LOCAL,
      );
    }
    if (p?.kind === 'resize' && g?.kind === 'resize') {
      const el = diagram?.elements[g.id];
      if (el?.type === 'loop') updateElement(doc, dId, g.id, { r: Math.round(g.w / 2) }, LOCAL);
      else updateElement(doc, dId, g.id, { x: g.x, y: g.y, w: g.w, h: g.h }, LOCAL);
    }
    if (p?.kind === 'curve' && g?.kind === 'curve')
      updateElement(doc, dId, g.id, { control: g.control }, LOCAL);
    if (p?.kind === 'link' && g?.kind === 'link') {
      if (p.linkId && p.end) {
        if (g.target)
          updateElement(doc, dId, p.linkId, { [p.end]: g.target, control: null }, LOCAL);
      } else if (g.target && st.layerId) {
        const id = addElement(
          doc,
          dId,
          {
            type: 'link',
            layerId: st.layerId,
            from: p.from,
            to: g.target,
            control: null,
            polarity: null,
          },
          LOCAL,
        );
        set({ selection: [id] });
        if (st.tool === 'link') finishTool();
      } else if (
        !g.target &&
        Math.hypot(
          g.point.x - (elementsRef.current[p.from] as { x: number }).x,
          g.point.y - (elementsRef.current[p.from] as { y: number }).y,
        ) > 40
      ) {
        // Released on empty canvas: create a new variable there, linked from the source.
        set({ editing: { kind: 'new-variable', x: g.point.x, y: g.point.y, linkFrom: p.from } });
        if (st.tool === 'link') finishTool();
      }
    }
    if (p?.kind === 'draw' && g?.kind === 'draw' && st.layerId) {
      let w = Math.abs(g.x1 - g.x0);
      let h = Math.abs(g.y1 - g.y0);
      let cx = (g.x0 + g.x1) / 2;
      let cy = (g.y0 + g.y1) / 2;
      if (w < 10 && h < 10) {
        w = 180;
        h = 110;
        cx = g.x0;
        cy = g.y0;
      }
      const id = addElement(
        doc,
        dId,
        {
          type: 'shape',
          layerId: st.layerId,
          shape: g.shape,
          x: Math.round(cx),
          y: Math.round(cy),
          w: Math.round(Math.max(w, 24)),
          h: Math.round(Math.max(h, 24)),
        },
        LOCAL,
      );
      set({ selection: [id] });
      finishTool();
    }
    set({ gesture: null, guides: null });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Pointer capture retargets click events to the <svg>, so hit-test the actual point.
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    if (target.closest('[data-overlay]')) return;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    const st = editor();
    if (handle === 'curve' && st.selection.length === 1 && canEdit) {
      updateElement(session.doc, st.diagramId!, st.selection[0]!, { control: null }, LOCAL);
      return;
    }
    const id = target.closest('[data-id]')?.getAttribute('data-id');
    const el: DiagramElement | undefined = id ? diagram?.elements[id] : undefined;
    if (!canEdit || st.tool !== 'select') return;
    if (
      el &&
      (el.type === 'variable' || el.type === 'text' || el.type === 'shape') &&
      editable(ctx, [el.id]).length
    ) {
      set({ editing: { kind: 'element', id: el.id }, selection: [el.id] });
    } else if (el?.type === 'loop' || el?.type === 'link') {
      set({ selection: [el.id], panelOpen: true, panelTab: 'design' });
    } else if (!el) {
      const w = toWorld(e.clientX, e.clientY);
      set({ editing: { kind: 'new-variable', x: w.x, y: w.y }, selection: [] });
    }
  };

  const onContextMenuCapture = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    const st = editor();
    if (id && !st.selection.includes(id)) set({ selection: [id] });
    if (!id) set({ selection: [] });
  };

  // ---- rendering helpers
  const z = viewport.zoom;
  const editingId = editing?.kind === 'element' ? editing.id : null;
  const single = selection.length === 1 ? diagram?.elements[selection[0]!] : undefined;
  const singleLayout = single ? layout.byId.get(single.id) : undefined;
  const effSingle = single ? elements[single.id] : undefined;
  const showHandles =
    canEdit &&
    !!single &&
    !!effSingle &&
    !!singleLayout &&
    editable(ctx, [single.id]).length > 0 &&
    (!gesture || gesture.kind === 'resize' || gesture.kind === 'curve');
  const hoverVar =
    hover &&
    elements[hover]?.type === 'variable' &&
    canEdit &&
    tool === 'select' &&
    !gesture &&
    !editing
      ? layout.byId.get(hover)
      : undefined;
  const linkDraft = gesture?.kind === 'link' ? gesture : null;
  const cursor =
    tool === 'hand'
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : tool === 'comment'
          ? 'copy'
          : tool === 'text'
            ? 'text'
            : 'crosshair';
  const gridSize = 16 * z;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-[var(--canvas)] touch-none select-none"
      style={{ cursor }}
      onContextMenuCapture={onContextMenuCapture}
      data-testid="canvas"
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 size-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => publish({ cursor: null })}
        onDoubleClick={onDoubleClick}
        onPointerOver={(e) => {
          const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
          if (id !== hover && !(e.target as Element).closest('[data-connector]')) setHover(id);
        }}
      >
        <defs>
          <pattern
            id="grid"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
            x={viewport.x % gridSize}
            y={viewport.y % gridSize}
          >
            <circle cx={1} cy={1} r={1} fill="var(--grid)" />
          </pattern>
        </defs>
        {z >= 0.4 && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${z})`}>
          {highlight.map((id) => {
            const l = layout.byId.get(id)?.link;
            return l ? (
              <path
                key={`hl-${id}`}
                d={l.d}
                stroke="#6366f1"
                strokeOpacity={0.3}
                strokeWidth={10}
                fill="none"
                strokeLinecap="round"
              />
            ) : null;
          })}
          {layout.order.map((id) => {
            const el = elements[id]!;
            const dimmed = !!(linkDraft && el.type !== 'link' && el.type !== 'variable');
            return (
              <ElementView
                key={id}
                layout={layout.byId.get(id)!}
                hideText={id === editingId}
                dimmed={dimmed || linkDraft?.linkId === id}
              />
            );
          })}

          {/* collaborators' selections */}
          {localPeers.map((peer) =>
            peer.selection.map((id) => {
              const b = layout.byId.get(id)?.bbox;
              if (!b) return null;
              return (
                <g key={`${peer.clientId}-${id}`} pointerEvents="none">
                  <rect
                    x={b.x - 4}
                    y={b.y - 4}
                    width={b.w + 8}
                    height={b.h + 8}
                    rx={4}
                    fill="none"
                    stroke={peer.user.color}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={b.x - 4}
                    y={b.y - 8}
                    fontSize={11 / z}
                    fill={peer.user.color}
                    fontWeight={600}
                    fontFamily="system-ui, sans-serif"
                  >
                    {peer.user.name}
                  </text>
                </g>
              );
            }),
          )}

          {/* own selection */}
          {selection.map((id) => {
            const lay = layout.byId.get(id);
            if (!lay) return null;
            if (lay.link)
              return (
                <path
                  key={`sel-${id}`}
                  d={lay.link.d}
                  stroke="#6366f1"
                  strokeOpacity={0.35}
                  strokeWidth={6}
                  fill="none"
                  pointerEvents="none"
                  strokeLinecap="round"
                />
              );
            const b = lay.bbox;
            return (
              <rect
                key={`sel-${id}`}
                x={b.x - 4}
                y={b.y - 4}
                width={b.w + 8}
                height={b.h + 8}
                rx={4}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })}

          {/* handles */}
          {showHandles &&
            effSingle!.type !== 'link' &&
            handlesFor(effSingle!).map((h) => {
              const pt = handlePoint(resizeBox(effSingle!, singleLayout!.bbox), h);
              const s = 9 / z;
              return (
                <rect
                  key={h}
                  data-handle={h}
                  x={pt.x - s / 2}
                  y={pt.y - s / 2}
                  width={s}
                  height={s}
                  rx={2 / z}
                  fill="white"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    cursor:
                      h === 'e' || h === 'w'
                        ? 'ew-resize'
                        : h === 'n' || h === 's'
                          ? 'ns-resize'
                          : h === 'nw' || h === 'se'
                            ? 'nwse-resize'
                            : 'nesw-resize',
                  }}
                />
              );
            })}
          {showHandles && singleLayout!.link && (
            <>
              {(['from', 'to'] as const).map((end) => {
                const pt = end === 'from' ? singleLayout!.link!.start : singleLayout!.link!.end;
                return (
                  <circle
                    key={end}
                    data-handle={end}
                    cx={pt.x}
                    cy={pt.y}
                    r={5 / z}
                    fill="white"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'move' }}
                  />
                );
              })}
              {effSingle!.type === 'link' && effSingle!.from !== effSingle!.to && (
                <circle
                  data-handle="curve"
                  cx={singleLayout!.link!.handle.x}
                  cy={singleLayout!.link!.handle.y}
                  r={6 / z}
                  fill="#6366f1"
                  stroke="white"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'grab' }}
                >
                  <title>Drag to curve · double-click to straighten</title>
                </circle>
              )}
            </>
          )}

          {/* connectors on hovered variables: drag to create a causal link */}
          {hoverVar &&
            (['n', 'e', 's', 'w'] as const)
              // Don't stack connectors on top of the selected variable's side resize handles.
              .filter(
                (side) =>
                  !(
                    showHandles &&
                    single?.id === hoverVar.id &&
                    (side === 'e' || side === 'w') &&
                    handlesFor(effSingle!).includes(side)
                  ),
              )
              .map((side) => {
                const b = hoverVar.bbox;
                const pt = handlePoint(
                  { x: b.x - 10 / z, y: b.y - 10 / z, w: b.w + 20 / z, h: b.h + 20 / z },
                  side,
                );
                return (
                  <g
                    key={side}
                    data-connector={hoverVar.id}
                    style={{ cursor: 'crosshair' }}
                    onPointerEnter={() => setHover(hoverVar.id)}
                  >
                    <circle cx={pt.x} cy={pt.y} r={10 / z} fill="transparent" />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4 / z}
                      fill="#6366f1"
                      stroke="white"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>Drag to draw a causal link</title>
                    </circle>
                  </g>
                );
              })}

          {/* link being drawn (own) */}
          {linkDraft && (
            <LinkDraft
              layout={layout}
              from={linkDraft.from}
              point={linkDraft.point}
              target={linkDraft.target}
              color="#6366f1"
              zoom={z}
            />
          )}
          {/* links being drawn by others */}
          {localPeers.map((peer) =>
            peer.gesture?.kind === 'link' ? (
              <LinkDraft
                key={`draft-${peer.clientId}`}
                layout={layout}
                from={peer.gesture.from}
                point={peer.gesture.point}
                target={peer.gesture.target}
                color={peer.user.color}
                zoom={z}
              />
            ) : null,
          )}

          {gesture?.kind === 'marquee' && (
            <rect
              x={Math.min(gesture.x0, gesture.x1)}
              y={Math.min(gesture.y0, gesture.y1)}
              width={Math.abs(gesture.x1 - gesture.x0)}
              height={Math.abs(gesture.y1 - gesture.y0)}
              fill="#6366f1"
              fillOpacity={0.08}
              stroke="#6366f1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {gesture?.kind === 'draw' && (
            <rect
              x={Math.min(gesture.x0, gesture.x1)}
              y={Math.min(gesture.y0, gesture.y1)}
              width={Math.abs(gesture.x1 - gesture.x0)}
              height={Math.abs(gesture.y1 - gesture.y0)}
              rx={gesture.shape === 'rounded' ? 12 : gesture.shape === 'ellipse' ? 999 : 0}
              fill={theme.shapeFill}
              fillOpacity={0.6}
              stroke={theme.shapeStroke}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {guides?.x !== undefined && (
            <line
              x1={guides.x}
              x2={guides.x}
              y1={-1e5}
              y2={1e5}
              stroke="#ec4899"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {guides?.y !== undefined && (
            <line
              y1={guides.y}
              y2={guides.y}
              x1={-1e5}
              x2={1e5}
              stroke="#ec4899"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      <CanvasOverlay layout={layout} elements={elements} peers={localPeers} size={size} />
    </div>
  );
}

function LinkDraft({
  layout,
  from,
  point,
  target,
  color,
  zoom,
}: {
  layout: DiagramLayout;
  from: string;
  point: Point;
  target: string | null;
  color: string;
  zoom: number;
}) {
  const a = layout.byId.get(from)?.boundary;
  if (!a) return null;
  const t = target ? layout.byId.get(target) : undefined;
  const end = t?.boundary ? { x: t.boundary.cx, y: t.boundary.cy } : point;
  return (
    <g pointerEvents="none">
      {t && (
        <rect
          x={t.bbox.x - 4}
          y={t.bbox.y - 4}
          width={t.bbox.w + 8}
          height={t.bbox.h + 8}
          rx={4}
          fill={color}
          fillOpacity={0.08}
          stroke={color}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <line
        x1={a.cx}
        y1={a.cy}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={end.x} cy={end.y} r={3.5 / zoom} fill={color} />
    </g>
  );
}
