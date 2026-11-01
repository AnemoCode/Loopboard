import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  CornerUpLeft,
  MessageCircle,
  Move,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { DiagramElement } from '@cld/model';
import {
  colorForUser,
  type ChangeSummary,
  type ChangesPage,
  type UndoResult,
  type VersionSummary,
} from '@cld/shared';
import { Avatar, Button, cx, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, useVersions } from '../lib/queries';
import { timeAgo } from '../lib/time';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { useEditor } from './store';

const KIND: Record<ChangeSummary['kind'], { icon: ReactNode; label: string }> = {
  add: { icon: <Plus className="size-3" />, label: 'Added' },
  delete: { icon: <Trash2 className="size-3" />, label: 'Deleted' },
  rename: { icon: <Type className="size-3" />, label: 'Renamed' },
  edit: { icon: <Pencil className="size-3" />, label: 'Edited' },
  style: { icon: <Palette className="size-3" />, label: 'Styled' },
  layout: { icon: <Move className="size-3" />, label: 'Layout' },
  comment: { icon: <MessageCircle className="size-3" />, label: 'Comment' },
  structure: { icon: <Shapes className="size-3" />, label: 'Structure' },
  restore: { icon: <RotateCcw className="size-3" />, label: 'Restored' },
  undo: { icon: <CornerUpLeft className="size-3" />, label: 'Undo' },
};

type Row =
  | { type: 'change'; at: number; change: ChangeSummary }
  | { type: 'version'; at: number; version: VersionSummary };

const dayLabel = (t: number) => {
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

/** Changelog of who changed what, interleaved with saved versions, updated live; entries can be undone. */
export function HistoryPanel() {
  const { projectId, session, store, canEdit } = useEditorCtx();
  const view = useDocView(store);
  const qc = useQueryClient();
  const set = useEditor((s) => s.set);
  const currentDiagram = useEditor((s) => s.diagramId);
  const [person, setPerson] = useState('all');
  const [undoing, setUndoing] = useState<number | null>(null);
  const changes = useInfiniteQuery({
    queryKey: keys.changes(projectId),
    queryFn: ({ pageParam }) =>
      api<ChangesPage>(
        `/projects/${projectId}/changes?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const versions = useVersions(projectId);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.changes(projectId) }),
      qc.invalidateQueries({ queryKey: keys.versions(projectId) }),
    ]);

  // The server pings connected clients whenever new entries or versions are stored.
  useEffect(() => session.onChanges(() => void refresh()), [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => changes.data?.pages.flatMap((p) => p.changes) ?? [], [changes.data]);
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all) if (c.userId) m.set(c.userId, c.userName);
    return [...m];
  }, [all]);

  const rows: Row[] = useMemo(() => {
    const list: Row[] = all
      .filter((c) => person === 'all' || c.userId === person)
      .map((c) => ({ type: 'change', at: Date.parse(c.createdAt), change: c }));
    const oldest = all.length ? Date.parse(all[all.length - 1]!.createdAt) : 0;
    for (const v of versions.data ?? []) {
      // Named, imported and restore points; autosaves live in the Version history dialog.
      if (v.kind === 'auto' || (person !== 'all' && v.createdBy !== person)) continue;
      const at = Date.parse(v.createdAt);
      if (!changes.hasNextPage || at >= oldest) list.push({ type: 'version', at, version: v });
    }
    return list.sort((a, b) => b.at - a.at);
  }, [all, versions.data, person, changes.hasNextPage]);

  const undo = async (c: ChangeSummary) => {
    setUndoing(c.id);
    try {
      const r = await api<UndoResult>(`/projects/${projectId}/changes/${c.id}/undo`, {
        method: 'POST',
      });
      if (r.applied && !r.skipped) toast.success('Change undone');
      else if (r.applied)
        toast.success('Partly undone', {
          description: `${r.skipped} part${r.skipped === 1 ? ' was' : 's were'} changed again later and left as is.`,
        });
      else
        toast.info('Nothing to undo', {
          description: 'This was already changed again later, so it was left as is.',
        });
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUndoing(null);
    }
  };

  /** Jump to the diagram of an entry, select what still exists and centre it. */
  const focus = (c: ChangeSummary) => {
    const d = c.diagramId ? view.snapshot.diagrams[c.diagramId] : undefined;
    if (!d) return;
    const els = c.elementIds.map((id) => d.elements[id]).filter((e): e is DiagramElement => !!e);
    const pos = (e: DiagramElement): { x: number; y: number } | null => {
      if (e.type !== 'link') return { x: e.x, y: e.y };
      const a = d.elements[e.from] as { x: number; y: number } | undefined;
      const b = d.elements[e.to] as { x: number; y: number } | undefined;
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    };
    const pts = els.map(pos).filter((p): p is { x: number; y: number } => !!p);
    const patch: Parameters<typeof set>[0] = {
      diagramId: d.id,
      selection: els.map((e) => e.id),
      followClientId: null,
    };
    if (pts.length) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const r = document.querySelector('[data-testid="canvas"]')?.getBoundingClientRect();
      const zoom = useEditor.getState().viewport.zoom;
      patch.viewport = {
        zoom,
        x: (r?.width ?? 800) / 2 - cx * zoom,
        y: (r?.height ?? 600) / 2 - cy * zoom,
      };
    }
    set(patch);
  };

  if (changes.isLoading) return <Spinner className="m-4" />;

  const out: ReactNode[] = [];
  let lastDay = '';
  for (const row of rows) {
    const day = dayLabel(row.at);
    if (day !== lastDay) {
      out.push(
        <li
          key={`day-${day}`}
          className="px-2 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted first:pt-1"
        >
          {day}
        </li>,
      );
      lastDay = day;
    }
    if (row.type === 'version') {
      const v = row.version;
      const title =
        v.kind === 'manual'
          ? `Saved version “${v.label}”`
          : v.kind === 'import'
            ? 'Imported the project'
            : 'Saved the state before a restore';
      out.push(
        <li key={`v-${v.id}`} className="py-1">
          <button
            onClick={() => set({ dialog: 'versions' })}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-accent-300 bg-accent-50/60 px-3 py-2.5 text-left hover:bg-accent-50 dark:border-accent-500/40 dark:bg-accent-500/10"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300">
              <Bookmark className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-app">{title}</span>
              <span className="text-xs text-muted">
                {v.createdByName ?? 'Someone'} · {timeAgo(v.createdAt)}
              </span>
            </span>
          </button>
        </li>,
      );
      continue;
    }
    const c = row.change;
    const otherDiagram =
      c.diagramId && c.diagramId !== currentDiagram
        ? view.snapshot.diagrams[c.diagramId]?.name
        : null;
    const clickable = !!c.diagramId && !!view.snapshot.diagrams[c.diagramId];
    const undone = !!c.undoneByName;
    out.push(
      <li key={c.id} className="group relative">
        <button
          disabled={!clickable}
          onClick={() => focus(c)}
          aria-label={`${c.userName} ${c.summary}`}
          className={cx(
            'flex w-full gap-3 rounded-xl px-2 py-2.5 pr-20 text-left',
            clickable && 'hover:bg-surface-2',
          )}
        >
          <Avatar
            name={c.userName}
            color={c.userId ? colorForUser(c.userId) : undefined}
            size={28}
          />
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                'block text-sm leading-snug',
                undone ? 'text-muted line-through decoration-[var(--muted)]' : 'text-app',
              )}
            >
              <span className="font-medium">{c.userName}</span>{' '}
              <span className="break-words">{c.summary}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                {KIND[c.kind].icon}
                {timeAgo(c.createdAt)}
              </span>
              {otherDiagram && <span>· {otherDiagram}</span>}
            </span>
            {undone && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                <Undo2 className="size-3" /> Undone by {c.undoneByName}
              </span>
            )}
          </span>
        </button>
        {canEdit && c.undoable && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Undo: ${c.summary}`}
            loading={undoing === c.id}
            onClick={() => undo(c)}
            className="absolute right-2 top-2.5 h-7 px-2.5 text-xs opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <Undo2 className="size-3.5" /> Undo
          </Button>
        )}
      </li>,
    );
  }

  return (
    <div className="px-2 py-3">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-sm text-muted">
          {canEdit ? 'Hover an entry to undo it.' : 'Changes by everyone, newest first.'}
        </span>
        {people.length > 1 && (
          <Select
            ariaLabel="Filter by person"
            value={person}
            onChange={setPerson}
            options={[
              { value: 'all', label: 'Everyone' },
              ...people.map(([id, name]) => ({ value: id, label: name })),
            ]}
            className="h-7 max-w-32 text-xs"
          />
        )}
      </div>
      {rows.length === 0 && (
        <p className="mt-6 px-2 text-sm text-muted">
          Nothing has changed yet. Edits made by anyone with access appear here.
        </p>
      )}
      <ol aria-label="Change history">{out}</ol>
      {changes.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 w-full"
          loading={changes.isFetchingNextPage}
          onClick={() => changes.fetchNextPage()}
        >
          Show older changes
        </Button>
      )}
    </div>
  );
}
