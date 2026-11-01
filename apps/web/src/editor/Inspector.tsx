import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, MessageCircle, Plus, RefreshCw, Trash2, Unlock, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addLayer, byKey, deleteLayer, findLoops, keyBetween, moveToLayer, updateLayer, type Layer } from '@cld/model';
import { Button, cx, IconButton } from '../components/ui';
import { timeAgo } from '../lib/time';
import { editable, placeLoopMarker } from './actions';
import { threadPosition } from './canvas/CanvasOverlay';
import { useEditorCtx } from './context';
import { DesignPanel } from './DesignPanel';
import { useDocView } from './docView';
import { LOCAL } from './session';
import { useEditor, type PanelTab } from './store';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'layers', label: 'Layers' },
  { id: 'loops', label: 'Loops' },
  { id: 'comments', label: 'Comments' },
];

export function Inspector() {
  const tab = useEditor((s) => s.panelTab);
  const set = useEditor((s) => s.set);
  return (
    <aside aria-label="Side panel" className="pointer-events-auto flex h-full w-80 shrink-0 flex-col border-l border-app bg-surface">
      <div className="flex items-center gap-0.5 border-b border-app px-2 py-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => set({ panelTab: t.id })}
            className={cx('rounded-md px-2 py-1 text-[13px] font-medium transition-colors', tab === t.id ? 'bg-surface-2 text-app' : 'text-muted hover:text-app')}
          >
            {t.label}
          </button>
        ))}
        <button aria-label="Close panel" className="ml-auto rounded-md p-1 text-muted hover:bg-surface-2 hover:text-app" onClick={() => set({ panelOpen: false })}>
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'design' && <DesignPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'loops' && <LoopsPanel />}
        {tab === 'comments' && <CommentsPanel />}
      </div>
    </aside>
  );
}

function LayersPanel() {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const { diagramId, layerId, selection } = useEditor();
  const set = useEditor((s) => s.set);
  const [renaming, setRenaming] = useState<string | null>(null);
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  if (!diagram) return null;
  // Top of the list = drawn on top.
  const layers = Object.values(diagram.layers).sort(byKey<Layer>((l) => l.order)).reverse();
  const doc = ctx.session.doc;
  const count = (id: string) => Object.values(diagram.elements).filter((e) => e.layerId === id).length;

  const move = (idx: number, dir: -1 | 1) => {
    // In display order (reversed); compute a new fractional key between the neighbours.
    const target = idx + dir;
    if (target < 0 || target >= layers.length) return;
    const asc = [...layers].reverse();
    const ai = asc.length - 1 - idx;
    const at = asc.length - 1 - target;
    const others = asc.filter((_, i) => i !== ai);
    const insertAt = at;
    const lo = others[insertAt - 1]?.order ?? null;
    const hi = others[insertAt]?.order ?? null;
    updateLayer(doc, diagram.id, asc[ai]!.id, { order: lo !== null && hi !== null && lo >= hi ? `${lo}V` : keyBetween(lo, hi) }, LOCAL);
  };

  return (
    <div className="p-3">
      <ul className="space-y-1">
        {layers.map((l, i) => (
          <li
            key={l.id}
            className={cx(
              'group flex items-center gap-1 rounded-lg border px-2 py-1.5',
              l.id === layerId ? 'border-accent-300 bg-accent-50 dark:border-accent-500/40 dark:bg-accent-500/10' : 'border-transparent hover:bg-surface-2',
            )}
          >
            <button className="min-w-0 flex-1 text-left" onClick={() => set({ layerId: l.id })} onDoubleClick={() => ctx.canEdit && setRenaming(l.id)} title="Click to draw on this layer · double-click to rename">
              {renaming === l.id ? (
                <input
                  autoFocus
                  aria-label="Layer name"
                  defaultValue={l.name}
                  onBlur={(e) => {
                    if (e.target.value.trim()) updateLayer(doc, diagram.id, l.id, { name: e.target.value.trim() }, LOCAL);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="w-full rounded border border-app bg-surface px-1 text-sm outline-none"
                />
              ) : (
                <span className={cx('block truncate text-sm', l.visible ? 'text-app' : 'text-muted line-through')}>
                  {l.name} <span className="text-xs text-muted">· {count(l.id)}</span>
                </span>
              )}
            </button>
            {ctx.canEdit && (
              <span className="flex opacity-60 group-hover:opacity-100">
                <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton size="sm" label="Move down" disabled={i === layers.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </IconButton>
              </span>
            )}
            <IconButton size="sm" label={l.visible ? 'Hide layer' : 'Show layer'} disabled={!ctx.canEdit} onClick={() => updateLayer(doc, diagram.id, l.id, { visible: !l.visible }, LOCAL)}>
              {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </IconButton>
            <IconButton size="sm" label={l.locked ? 'Unlock layer' : 'Lock layer'} disabled={!ctx.canEdit} onClick={() => updateLayer(doc, diagram.id, l.id, { locked: !l.locked }, LOCAL)}>
              {l.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
            </IconButton>
            {ctx.canEdit && layers.length > 1 && (
              <IconButton
                size="sm"
                label="Delete layer (elements move to the layer below)"
                onClick={() => {
                  const fallback = layers[i + 1] ?? layers[i - 1]!;
                  deleteLayer(doc, diagram.id, l.id, fallback.id, LOCAL);
                  if (layerId === l.id) set({ layerId: fallback.id });
                }}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {ctx.canEdit && (
        <div className="mt-3 space-y-2">
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              const id = addLayer(doc, diagram.id, `Layer ${layers.length + 1}`, LOCAL);
              set({ layerId: id });
            }}
          >
            <Plus className="size-4" /> Add layer
          </Button>
          {selection.length > 0 && layerId && (
            <Button size="sm" variant="ghost" className="w-full" onClick={() => moveToLayer(doc, diagram.id, editable(ctx, selection), layerId, LOCAL)}>
              Move selection to “{diagram.layers[layerId]?.name}”
            </Button>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">New elements go on the highlighted layer. Hidden layers are left out of image and PDF exports unless you choose otherwise.</p>
    </div>
  );
}

function LoopsPanel() {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const diagramId = useEditor((s) => s.diagramId);
  const set = useEditor((s) => s.set);
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  const result = useMemo(() => (diagram ? findLoops(diagram) : null), [diagram]);
  if (!diagram || !result) return null;
  const markers = Object.values(diagram.elements).filter((e) => e.type === 'loop');
  const name = (id: string) => view.variables[id]?.name ?? '?';
  const counts = { R: result.loops.filter((l) => l.kind === 'R').length, B: result.loops.filter((l) => l.kind === 'B').length };
  return (
    <div className="p-3" onMouseLeave={() => set({ highlight: [] })}>
      <p className="px-1 text-sm text-muted">
        {result.loops.length === 0
          ? 'No feedback loops yet. Connect variables in a circle to create one.'
          : `${result.loops.length} feedback loop${result.loops.length === 1 ? '' : 's'}: ${counts.R} reinforcing, ${counts.B} balancing${result.truncated ? ' (showing the first 200)' : ''}.`}
      </p>
      <ul className="mt-3 space-y-1.5">
        {result.loops.map((loop) => {
          const placed = markers.some((m) => Math.hypot(m.x - loop.center.x, m.y - loop.center.y) < 60 && (m.kind === loop.kind || loop.kind === '?'));
          return (
            <li
              key={loop.key}
              onMouseEnter={() => set({ highlight: loop.linkIds })}
              onFocus={() => set({ highlight: loop.linkIds })}
              className="rounded-lg border border-app p-2.5 hover:bg-surface-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    'flex size-6 items-center justify-center rounded-full text-xs font-bold',
                    loop.kind === 'R' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : loop.kind === 'B' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-surface-2 text-muted',
                  )}
                  title={loop.kind === 'R' ? 'Reinforcing' : loop.kind === 'B' ? 'Balancing' : 'Some links have no polarity'}
                >
                  {loop.kind}
                </span>
                <span className="text-xs text-muted">
                  {loop.variableIds.length} variables · {loop.direction === 'cw' ? '↻' : '↺'}
                </span>
                {ctx.canEdit && !placed && (
                  <button className="ml-auto flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline dark:text-accent-300" onClick={() => placeLoopMarker(ctx, loop)}>
                    <RefreshCw className="size-3" /> Add marker
                  </button>
                )}
                {placed && <span className="ml-auto text-xs text-muted">Marked</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-app">{[...loop.variableIds, loop.variableIds[0]!].map(name).join(' → ')}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommentsPanel() {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const { diagramId, showResolved, viewport } = useEditor();
  const set = useEditor((s) => s.set);
  const threads = view.comments.filter((t) => t.diagramId === diagramId && (showResolved || !t.resolved));
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  const open = (id: string) => {
    const t = view.snapshot.comments[id];
    const pos = t && diagram ? threadPosition(t, diagram.elements) : null;
    const canvas = document.querySelector('[data-testid="canvas"]');
    if (pos && canvas) {
      const r = canvas.getBoundingClientRect();
      set({ viewport: { ...viewport, x: r.width / 2 - pos.x * viewport.zoom, y: r.height / 2 - pos.y * viewport.zoom } });
    }
    set({ openThread: id });
  };
  return (
    <div className="p-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm text-muted">{threads.length ? `${threads.length} comment${threads.length === 1 ? '' : 's'}` : 'No comments'}</span>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-[var(--ring)]" checked={showResolved} onChange={(e) => set({ showResolved: e.target.checked })} />
          Show resolved
        </label>
      </div>
      {ctx.canComment && (
        <p className="mt-2 px-1 text-xs text-muted">
          Press <b className="text-app">C</b> and click the canvas or an element to start a comment.
        </p>
      )}
      <ul className="mt-3 space-y-1.5">
        {threads.map((t) => (
          <li key={t.id}>
            <button onClick={() => open(t.id)} className={cx('w-full rounded-lg border border-app p-2.5 text-left hover:bg-surface-2', t.resolved && 'opacity-60')}>
              <div className="flex items-center gap-2 text-xs text-muted">
                <MessageCircle className="size-3.5" />
                <span className="font-medium text-app">{t.messages[0]?.authorName}</span>
                <span>{timeAgo(t.createdAt)}</span>
                {t.messages.length > 1 && <span className="ml-auto">{t.messages.length - 1} repl{t.messages.length === 2 ? 'y' : 'ies'}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-app">{t.messages[0]?.body}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
