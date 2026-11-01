import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Bookmark,
  MessageCircle,
  Move,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DiagramElement } from '@cld/model';
import {
  colorForUser,
  type ChangeSummary,
  type ChangesPage,
  type VersionSummary,
} from '@cld/shared';
import { Avatar, Button, cx, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { keys, useVersions } from '../lib/queries';
import { timeAgo } from '../lib/time';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { useEditor } from './store';

const KIND_ICON: Record<ChangeSummary['kind'], ReactNode> = {
  add: <Plus className="size-3" />,
  delete: <Trash2 className="size-3" />,
  rename: <Type className="size-3" />,
  edit: <Pencil className="size-3" />,
  style: <Palette className="size-3" />,
  layout: <Move className="size-3" />,
  comment: <MessageCircle className="size-3" />,
  structure: <Shapes className="size-3" />,
  restore: <RotateCcw className="size-3" />,
};

type Row =
  | { type: 'change'; at: number; change: ChangeSummary }
  | { type: 'version'; at: number; version: VersionSummary };

const dayLabel = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

/** Changelog of who changed what, interleaved with saved versions, updated live. */
export function HistoryPanel() {
  const { projectId, session, store } = useEditorCtx();
  const view = useDocView(store);
  const qc = useQueryClient();
  const set = useEditor((s) => s.set);
  const currentDiagram = useEditor((s) => s.diagramId);
  const [person, setPerson] = useState('all');
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

  // The server pings connected clients whenever new entries are stored.
  useEffect(
    () =>
      session.onChanges(() => {
        void qc.invalidateQueries({ queryKey: keys.changes(projectId) });
        void qc.invalidateQueries({ queryKey: keys.versions(projectId) });
      }),
    [session, qc, projectId],
  );

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
      if (v.kind === 'auto') continue;
      if (person !== 'all' && v.createdBy !== person) continue;
      const at = Date.parse(v.createdAt);
      if (!changes.hasNextPage || at >= oldest) list.push({ type: 'version', at, version: v });
    }
    return list.sort((a, b) => b.at - a.at);
  }, [all, versions.data, person, changes.hasNextPage]);

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

  let lastDay = '';
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-sm text-muted">Changes by everyone, newest first.</span>
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
        <p className="mt-6 px-1 text-sm text-muted">
          Nothing has changed yet. Edits made by anyone with access appear here.
        </p>
      )}
      <ol className="mt-2" aria-label="Change history">
        {rows.map((row) => {
          const day = dayLabel(row.at);
          const header =
            day !== lastDay ? (
              <li
                key={`day-${day}`}
                className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {day}
              </li>
            ) : null;
          lastDay = day;
          if (row.type === 'version') {
            const v = row.version;
            const title =
              v.kind === 'manual'
                ? `Saved version “${v.label}”`
                : v.kind === 'import'
                  ? 'Imported the project'
                  : 'Saved the state before a restore';
            return [
              header,
              <li key={`v-${v.id}`}>
                <button
                  onClick={() => set({ dialog: 'versions' })}
                  className="my-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-accent-300 bg-accent-50/60 px-2.5 py-2 text-left text-sm hover:bg-accent-50 dark:border-accent-500/40 dark:bg-accent-500/10"
                >
                  <Bookmark className="size-4 shrink-0 text-accent-600 dark:text-accent-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-app">{title}</span>
                    <span className="text-xs text-muted">
                      {v.createdByName ?? 'Someone'} · {timeAgo(v.createdAt)}
                    </span>
                  </span>
                </button>
              </li>,
            ];
          }
          const c = row.change;
          const otherDiagram =
            c.diagramId && c.diagramId !== currentDiagram
              ? view.snapshot.diagrams[c.diagramId]?.name
              : null;
          const clickable = !!c.diagramId && !!view.snapshot.diagrams[c.diagramId];
          return [
            header,
            <li key={c.id}>
              <button
                disabled={!clickable}
                onClick={() => focus(c)}
                className={cx(
                  'group flex w-full gap-2.5 rounded-lg px-1.5 py-1.5 text-left',
                  clickable && 'hover:bg-surface-2',
                )}
              >
                <span className="relative mt-0.5 shrink-0">
                  <Avatar
                    name={c.userName}
                    color={c.userId ? colorForUser(c.userId) : undefined}
                    size={24}
                  />
                  <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-[var(--border)]">
                    {KIND_ICON[c.kind]}
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug text-app">
                  <span className="font-medium">{c.userName}</span>{' '}
                  <span className="break-words">{c.summary}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    {timeAgo(c.createdAt)}
                    {otherDiagram && (
                      <>
                        <ArrowRightLeft className="size-3" /> {otherDiagram}
                      </>
                    )}
                  </span>
                </span>
              </button>
            </li>,
          ];
        })}
      </ol>
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
