import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  CloudOff,
  Copy,
  Download,
  FileUp,
  History,
  Keyboard,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Search,
  Pencil,
  Plus,
  Redo2,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  addDiagram,
  appendSnapshot,
  deleteDiagram,
  duplicateDiagram,
  renameDiagram,
} from '@cld/model';
import { ROLE_LABELS } from '@cld/shared';
import { LogoMark } from '../components/Logo';
import { UserMenu } from '../components/UserMenu';
import {
  Avatar,
  Button,
  cx,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ACCEPTED_FILES, readDiagramFile } from '../lib/files';
import { keys } from '../lib/queries';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { uniqueUsers, type Peer } from './presence';
import { LOCAL } from './session';
import { useEditor } from './store';

export function TopBar({ peers }: { peers: Peer[] }) {
  const ctx = useEditorCtx();
  const { session, canEdit, role } = ctx;
  const set = useEditor((s) => s.set);
  const panelOpen = useEditor((s) => s.panelOpen);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = useSyncExternalStore(session.subscribe, () => session.status);
  const [, force] = useState(0);
  useEffect(() => {
    const u = session.undo;
    const f = () => force((n) => n + 1);
    u.on('stack-item-added', f);
    u.on('stack-item-popped', f);
    return () => {
      u.off('stack-item-added', f);
      u.off('stack-item-popped', f);
    };
  }, [session]);

  const importInto = async (file: File) => {
    try {
      const loaded = await readDiagramFile(file);
      const ids = appendSnapshot(session.doc, loaded.snapshot, LOCAL);
      if (ids[0]) set({ diagramId: ids[0], selection: [] });
      toast.success(
        `Imported ${ids.length} diagram${ids.length === 1 ? '' : 's'} from ${file.name}`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <header className="pointer-events-auto flex h-12 items-center gap-2 border-b border-app bg-surface px-2 sm:px-3">
      <Tooltip content="All projects">
        <Link
          to="/"
          aria-label="All projects"
          className="shrink-0 rounded-lg p-1 hover:bg-surface-2"
        >
          <LogoMark size={26} />
        </Link>
      </Tooltip>
      <ProjectTitle />
      {canEdit && (
        <div className="hidden items-center sm:flex">
          <IconButton
            size="sm"
            label="Undo"
            shortcut="⌘Z"
            disabled={!session.undo.canUndo()}
            onClick={() => session.undo.undo()}
          >
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton
            size="sm"
            label="Redo"
            shortcut="⇧⌘Z"
            disabled={!session.undo.canRedo()}
            onClick={() => session.undo.redo()}
          >
            <Redo2 className="size-4" />
          </IconButton>
        </div>
      )}
      <DiagramTabs peers={peers} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <SyncBadge status={status} />
        <Presence peers={peers} />
        {!canEdit && (
          <span className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted md:inline">
            {ROLE_LABELS[role]}
          </span>
        )}
        <Button size="sm" variant="primary" onClick={() => set({ dialog: 'share' })}>
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <button aria-label="More" className="rounded-lg p-1.5 text-app hover:bg-surface-2">
              <MoreHorizontal className="size-5" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Search className="size-4" />}
              shortcut="⌘K"
              onSelect={() => set({ dialog: 'palette' })}
            >
              Search…
            </MenuItem>
            <MenuItem
              icon={<Download className="size-4" />}
              shortcut="⌘E"
              onSelect={() => set({ dialog: 'export' })}
            >
              Export…
            </MenuItem>
            <MenuItem
              icon={<FileUp className="size-4" />}
              disabled={!canEdit}
              onSelect={() => fileRef.current?.click()}
            >
              Import into project…
            </MenuItem>
            <MenuItem
              icon={<History className="size-4" />}
              onSelect={() => set({ dialog: 'versions' })}
            >
              Version history
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<PanelRight className="size-4" />}
              shortcut="⌘."
              checked={panelOpen}
              onSelect={() => set({ panelOpen: !panelOpen })}
            >
              Show side panel
            </MenuItem>
            <MenuItem
              icon={<Keyboard className="size-4" />}
              shortcut="?"
              onSelect={() => set({ dialog: 'shortcuts' })}
            >
              Keyboard shortcuts
            </MenuItem>
          </MenuContent>
        </Menu>
        <UserMenu />
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={ACCEPTED_FILES}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importInto(f);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}

function ProjectTitle() {
  const { projectId, projectName, canEdit } = useEditorCtx();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(projectName);
  useEffect(() => setValue(projectName), [projectName]);
  const save = async () => {
    setEditing(false);
    const name = value.trim();
    if (!name || name === projectName) return setValue(projectName);
    try {
      await api(`/projects/${projectId}`, { method: 'PATCH', body: { name } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.project(projectId) }),
        qc.invalidateQueries({ queryKey: keys.projects }),
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
      setValue(projectName);
    }
  };
  if (editing)
    return (
      <input
        autoFocus
        aria-label="Project name"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            setValue(projectName);
            setEditing(false);
          }
        }}
        className="h-8 w-48 rounded-md border border-app bg-surface px-2 text-sm font-medium text-app outline-none focus:ring-2 focus:ring-[var(--ring)]/40"
      />
    );
  return (
    <button
      className="max-w-[28vw] truncate rounded-md px-2 py-1 text-sm font-semibold text-app hover:bg-surface-2 disabled:hover:bg-transparent"
      onClick={() => canEdit && setEditing(true)}
      disabled={!canEdit}
      title={canEdit ? 'Rename project' : projectName}
    >
      {projectName}
    </button>
  );
}

function DiagramTabs({ peers }: { peers: Peer[] }) {
  const { session, store, canEdit } = useEditorCtx();
  const view = useDocView(store);
  const diagramId = useEditor((s) => s.diagramId);
  const set = useEditor((s) => s.set);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const doc = session.doc;

  const startRename = (id: string, name: string) => {
    if (!canEdit) return;
    setRenaming(id);
    setValue(name);
  };
  const commitRename = () => {
    if (renaming && value.trim()) renameDiagram(doc, renaming, value.trim().slice(0, 200), LOCAL);
    setRenaming(null);
  };

  return (
    <nav
      aria-label="Diagrams"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {view.diagrams.map((d) => {
        const active = d.id === diagramId;
        const here = uniqueUsers(peers.filter((p) => p.diagramId === d.id));
        if (renaming === d.id)
          return (
            <input
              key={d.id}
              autoFocus
              aria-label="Diagram name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="h-7 w-36 shrink-0 rounded-md border border-app bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]/40"
            />
          );
        return (
          <div
            key={d.id}
            className={cx(
              'group flex h-8 shrink-0 items-center rounded-lg text-sm transition-colors',
              active
                ? 'bg-surface-2 font-medium text-app'
                : 'text-muted hover:bg-surface-2 hover:text-app',
            )}
          >
            <button
              role="tab"
              aria-selected={active}
              className="flex h-full items-center gap-1.5 pl-3 pr-2"
              onClick={() =>
                set({
                  diagramId: d.id,
                  selection: [],
                  editing: null,
                  openThread: null,
                  draftComment: null,
                })
              }
              onDoubleClick={() => startRename(d.id, d.name)}
            >
              <span className="max-w-40 truncate">{d.name}</span>
              {here.length > 0 && (
                <span className="flex -space-x-1">
                  {here.slice(0, 3).map((p) => (
                    <span
                      key={p.user.id}
                      className="size-2 rounded-full ring-1 ring-[var(--surface)]"
                      style={{ background: p.user.color }}
                      title={p.user.name}
                    />
                  ))}
                </span>
              )}
            </button>
            {active && canEdit && (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    aria-label={`${d.name} options`}
                    className="mr-1 rounded p-0.5 text-muted hover:text-app"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuItem
                    icon={<Pencil className="size-4" />}
                    onSelect={() => startRename(d.id, d.name)}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem
                    icon={<Copy className="size-4" />}
                    onSelect={() => {
                      const id = duplicateDiagram(doc, d.id, LOCAL);
                      if (id) set({ diagramId: id, selection: [] });
                    }}
                  >
                    Duplicate
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 className="size-4" />}
                    danger
                    disabled={view.diagrams.length <= 1}
                    onSelect={() => {
                      const idx = view.diagrams.findIndex((x) => x.id === d.id);
                      const next = view.diagrams[idx === 0 ? 1 : idx - 1];
                      if (deleteDiagram(doc, d.id, LOCAL)) {
                        set({ diagramId: next?.id ?? null, selection: [] });
                        toast(`Deleted “${d.name}”`, {
                          action: { label: 'Undo', onClick: () => session.undo.undo() },
                        });
                      }
                    }}
                  >
                    Delete diagram
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </div>
        );
      })}
      {canEdit && (
        <IconButton
          size="sm"
          label="New diagram"
          onClick={() => {
            const id = addDiagram(doc, `Diagram ${view.diagrams.length + 1}`, LOCAL);
            set({ diagramId: id, selection: [] });
          }}
        >
          <Plus className="size-4" />
        </IconButton>
      )}
    </nav>
  );
}

function SyncBadge({ status }: { status: string }) {
  if (status === 'synced')
    return (
      <Tooltip content="All changes saved">
        <span className="hidden size-2 rounded-full bg-emerald-500 sm:block" aria-label="Saved" />
      </Tooltip>
    );
  if (status === 'offline')
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        <CloudOff className="size-3.5" /> Offline
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-muted" aria-live="polite">
      <Loader2 className="size-3.5 animate-spin" /> {status === 'saving' ? 'Saving' : 'Connecting'}
    </span>
  );
}

function Presence({ peers }: { peers: Peer[] }) {
  const { store } = useEditorCtx();
  const view = useDocView(store);
  const follow = useEditor((s) => s.followClientId);
  const set = useEditor((s) => s.set);
  const users = uniqueUsers(peers);
  if (!users.length) return null;
  return (
    <div className="flex -space-x-1.5">
      {users.slice(0, 5).map((p) => {
        const diagramName = view.snapshot.diagrams[p.diagramId ?? '']?.name;
        const following = follow === p.clientId;
        return (
          <Tooltip
            key={p.user.id}
            content={`${p.user.name}${diagramName ? ` · ${diagramName}` : ''} — ${following ? 'click to stop following' : 'click to follow'}`}
          >
            <button
              aria-label={`${following ? 'Stop following' : 'Follow'} ${p.user.name}`}
              onClick={() =>
                set({
                  followClientId: following ? null : p.clientId,
                  ...(following || !p.diagramId ? {} : { diagramId: p.diagramId }),
                })
              }
              className={cx(
                'rounded-full ring-2',
                following ? 'ring-offset-2 ring-offset-[var(--surface)]' : 'ring-[var(--surface)]',
              )}
              style={
                following ? ({ '--tw-ring-color': p.user.color } as React.CSSProperties) : undefined
              }
            >
              <Avatar name={p.user.name} color={p.user.color} size={28} />
            </button>
          </Tooltip>
        );
      })}
      {users.length > 5 && (
        <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-muted ring-2 ring-[var(--surface)]">
          +{users.length - 5}
        </span>
      )}
    </div>
  );
}
