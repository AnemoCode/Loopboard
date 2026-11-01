import { MessageCircle, MousePointer2 } from 'lucide-react';
import type { CommentThread, DiagramElement, Point } from '@cld/model';
import type { DiagramLayout } from '@cld/render';
import { Popover, PopoverAnchor, PopoverContent } from '../../components/ui';
import { NewCommentForm, ThreadView } from '../comments';
import { useEditorCtx } from '../context';
import { useDocView } from '../docView';
import type { Peer } from '../presence';
import { useEditor } from '../store';
import { TextEditor } from './TextEditor';

/** World position of a comment thread (anchored threads follow their element). */
export function threadPosition(t: { elementId?: string; x: number; y: number }, elements: Record<string, DiagramElement>): Point | null {
  if (!t.elementId) return { x: t.x, y: t.y };
  const el = elements[t.elementId] as { x?: number; y?: number } | undefined;
  if (el?.x === undefined || el.y === undefined) return null;
  return { x: el.x + t.x, y: el.y + t.y };
}

export function CanvasOverlay({ layout, elements, peers, size }: { layout: DiagramLayout; elements: Record<string, DiagramElement>; peers: Peer[]; size: { w: number; h: number } }) {
  const { store, canEdit } = useEditorCtx();
  const view = useDocView(store);
  const { viewport, diagramId, openThread, draftComment, showResolved, editing } = useEditor();
  const set = useEditor((s) => s.set);
  const toScreen = (p: Point) => ({ left: p.x * viewport.zoom + viewport.x, top: p.y * viewport.zoom + viewport.y });
  const threads = view.comments.filter((t) => t.diagramId === diagramId && (showResolved || !t.resolved || t.id === openThread));
  const empty = layout.order.length === 0 && !editing;
  const draftPos = draftComment ? threadPosition(draftComment, elements) : null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-xs text-center">
            <p className="text-sm font-medium text-app">This diagram is empty</p>
            <p className="mt-1 text-sm text-muted">
              {canEdit ? 'Double-click anywhere to add a variable, then drag from its edge to draw a causal link.' : 'Nothing has been drawn here yet.'}
            </p>
          </div>
        </div>
      )}

      {threads.map((t) => {
        const pos = threadPosition(t, elements);
        if (!pos) return null;
        return <Pin key={t.id} thread={t} style={toScreen(pos)} open={openThread === t.id} onOpenChange={(o) => set({ openThread: o ? t.id : null })} />;
      })}

      {draftPos && diagramId && (
        <Popover open onOpenChange={(o) => !o && set({ draftComment: null })}>
          <PopoverAnchor asChild>
            <div className="absolute size-0" style={toScreen(draftPos)} />
          </PopoverAnchor>
          <PopoverContent side="right" align="start">
            <NewCommentForm diagramId={diagramId} />
          </PopoverContent>
        </Popover>
      )}

      <div className="pointer-events-auto">
        <TextEditor layout={layout} elements={elements} />
      </div>

      {peers.map((p) => {
        if (!p.cursor) return null;
        const s = toScreen(p.cursor);
        if (s.left < -20 || s.top < -20 || s.left > size.w + 20 || s.top > size.h + 20) return null;
        return (
          <div key={p.clientId} className="absolute transition-transform duration-75 ease-linear will-change-transform" style={{ transform: `translate(${s.left}px, ${s.top}px)` }}>
            <MousePointer2 className="size-4 -translate-x-[2px] -translate-y-[2px]" style={{ color: p.user.color, fill: p.user.color }} strokeWidth={1.5} stroke="white" />
            <span className="ml-3 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm" style={{ background: p.user.color }}>
              {p.user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Pin({ thread, style, open, onOpenChange }: { thread: CommentThread; style: { left: number; top: number }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const count = thread.messages.length;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          data-overlay
          aria-label={`Comment by ${thread.messages[0]?.authorName ?? 'someone'}`}
          onClick={() => onOpenChange(!open)}
          className={`pointer-events-auto absolute flex -translate-y-full items-center gap-1 rounded-full rounded-bl-none border px-1.5 py-1 text-xs font-semibold shadow-md transition-transform hover:scale-105 ${
            thread.resolved ? 'border-app bg-surface-2 text-muted' : 'border-accent-600 bg-accent-600 text-white'
          }`}
          style={style}
        >
          <MessageCircle className="size-3.5" />
          {count > 1 && <span>{count}</span>}
        </button>
      </PopoverAnchor>
      <PopoverContent side="right" align="start">
        <ThreadView thread={thread} />
      </PopoverContent>
    </Popover>
  );
}
