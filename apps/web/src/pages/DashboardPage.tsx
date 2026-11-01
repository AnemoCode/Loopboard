import { useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  FileUp,
  FolderOpen,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { emptySnapshot } from '@cld/model';
import { ROLE_LABELS, type ProjectSummary } from '@cld/shared';
import { Logo } from '../components/Logo';
import { UserMenu } from '../components/UserMenu';
import {
  Button,
  cx,
  Dialog,
  EmptyState,
  Field,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ACCEPTED_FILES, readDiagramFile } from '../lib/files';
import { keys, useMe, useProjects } from '../lib/queries';
import { TEMPLATES } from '../lib/templates';
import { timeAgo } from '../lib/time';

export function DashboardPage() {
  const projects = useProjects();
  const me = useMe().data!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.projects });

  async function importFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setImporting(true);
    try {
      let lastId = '';
      for (const file of list) {
        const loaded = await readDiagramFile(file);
        const { id } = await api<{ id: string }>('/projects', {
          body: { name: loaded.name, snapshot: loaded.snapshot },
        });
        lastId = id;
        if (loaded.warnings.length)
          toast.warning(`${file.name}: ${loaded.warnings.length} note(s) while importing`, {
            description: loaded.warnings.slice(0, 3).join(' '),
          });
      }
      await refresh();
      if (list.length === 1) navigate(`/p/${lastId}`);
      else toast.success(`Imported ${list.length} files`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setImporting(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void importFiles(e.dataTransfer.files);
  };

  const visible = (projects.data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || (filter === 'mine' ? p.role === 'owner' : p.role !== 'owner')),
  );

  return (
    <div
      className="min-h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="sticky top-0 z-10 border-b border-app bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-app">Projects</h1>
            <p className="mt-1 text-sm text-muted">
              Hi {me.name.split(' ')[0]}, pick up where you left off or start something new.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => fileInput.current?.click()} loading={importing}>
              <FileUp className="size-4" /> Import
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New project
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_FILES}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void importFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
            {(['all', 'mine', 'shared'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cx(
                  'rounded-md px-3 py-1 text-sm font-medium',
                  filter === f ? 'bg-surface text-app shadow-sm' : 'text-muted hover:text-app',
                )}
              >
                {f === 'all' ? 'All' : f === 'mine' ? 'Owned by me' : 'Shared with me'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          {projects.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          ) : projects.error ? (
            <p className="text-sm text-red-600">{errorMessage(projects.error)}</p>
          ) : visible.length === 0 ? (
            projects.data?.length ? (
              <EmptyState icon={<Search className="size-5" />} title="No matching projects" />
            ) : (
              <EmptyState
                icon={<FolderOpen className="size-5" />}
                title="No projects yet"
                action={
                  <>
                    <Button onClick={() => fileInput.current?.click()}>
                      <FileUp className="size-4" /> Import .mdl
                    </Button>
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      <Plus className="size-4" /> New project
                    </Button>
                  </>
                }
              >
                Create a causal loop diagram from scratch or a system archetype, or drop a Vensim
                .mdl file anywhere on this page.
              </EmptyState>
            )
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onRename={() => setRenaming(p)}
                  onDelete={() => setDeleting(p)}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      {dragOver && (
        <div className="pointer-events-none fixed inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent-500 bg-accent-50/80 dark:bg-accent-500/10">
          <p className="text-lg font-medium text-accent-700 dark:text-accent-300">
            Drop .mdl or .cld.json files to import
          </p>
        </div>
      )}

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      {renaming && (
        <RenameDialog project={renaming} onClose={() => setRenaming(null)} onDone={refresh} />
      )}
      {deleting && (
        <DeleteDialog
          project={deleting}
          onClose={() => setDeleting(null)}
          onDone={refresh}
          myId={me.id}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project: p,
  onRename,
  onDelete,
  onChanged,
}: {
  project: ProjectSummary;
  onRename: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const duplicate = async () => {
    try {
      const { id } = await api<{ id: string }>(`/projects/${p.id}/duplicate`, { method: 'POST' });
      onChanged();
      toast.success('Project duplicated', {
        action: { label: 'Open', onClick: () => navigate(`/p/${id}`) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-app bg-surface shadow-sm transition-shadow hover:shadow-md">
      <Link to={`/p/${p.id}`} className="block focus:outline-none" aria-label={`Open ${p.name}`}>
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden border-b border-app bg-[var(--canvas)] p-3">
          <img
            src={`/api/projects/${p.id}/thumbnail.svg?v=${encodeURIComponent(p.updatedAt)}`}
            alt=""
            loading="lazy"
            className="max-h-full max-w-full object-contain dark:invert dark:hue-rotate-180"
          />
        </div>
        <div className="px-4 py-3">
          <div className="truncate pr-8 font-medium text-app">{p.name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span>Edited {timeAgo(p.updatedAt)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {p.memberCount}
            </span>
            {p.role !== 'owner' && (
              <>
                <span aria-hidden>·</span>
                <span>{ROLE_LABELS[p.role]}</span>
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="absolute bottom-3 right-2">
        <Menu>
          <MenuTrigger asChild>
            <button
              aria-label={`Actions for ${p.name}`}
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-app"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<FolderOpen className="size-4" />}
              onSelect={() => navigate(`/p/${p.id}`)}
            >
              Open
            </MenuItem>
            <MenuItem
              icon={<Pencil className="size-4" />}
              disabled={p.role === 'viewer' || p.role === 'commenter'}
              onSelect={onRename}
            >
              Rename
            </MenuItem>
            <MenuItem icon={<Copy className="size-4" />} onSelect={duplicate}>
              Duplicate
            </MenuItem>
            <MenuSeparator />
            {p.role === 'owner' ? (
              <MenuItem icon={<Trash2 className="size-4" />} danger onSelect={onDelete}>
                Delete
              </MenuItem>
            ) : (
              <MenuItem icon={<LogOut className="size-4" />} danger onSelect={onDelete}>
                Leave project
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('blank');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const create = async () => {
    setBusy(true);
    try {
      const t = TEMPLATES.find((x) => x.id === template);
      const snapshot = t ? t.build() : emptySnapshot();
      const { id } = await api<{ id: string }>('/projects', {
        body: { name: name.trim() || t?.name || 'Untitled diagram', snapshot },
      });
      onOpenChange(false);
      navigate(`/p/${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      wide
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={create}>
            Create project
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="space-y-5"
      >
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Coffee agroforestry"
            maxLength={200}
          />
        </Field>
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Start from</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { id: 'blank', name: 'Blank diagram', description: 'An empty canvas.' },
              ...TEMPLATES,
            ].map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={cx(
                  'rounded-xl border p-3 text-left transition-colors',
                  template === t.id
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-500/10'
                    : 'border-app hover:bg-surface-2',
                )}
              >
                <div className="text-sm font-medium text-app">{t.name}</div>
                <div className="mt-0.5 text-xs text-muted">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  project,
  onClose,
  onDone,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api(`/projects/${project.id}`, { method: 'PATCH', body: { name: name.trim() } });
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Rename project"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          autoFocus
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  project,
  onClose,
  onDone,
  myId,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onDone: () => void;
  myId: string;
}) {
  const [busy, setBusy] = useState(false);
  const owner = project.role === 'owner';
  const run = async () => {
    setBusy(true);
    try {
      if (owner) await api(`/projects/${project.id}`, { method: 'DELETE' });
      else await api(`/projects/${project.id}/members/${myId}`, { method: 'DELETE' });
      onDone();
      onClose();
      toast.success(owner ? 'Project deleted' : 'You left the project');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={owner ? 'Delete project?' : 'Leave project?'}
      description={
        owner
          ? `“${project.name}” and its version history will be permanently deleted for everyone. This can't be undone.`
          : `You'll lose access to “${project.name}” until someone invites you again.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={run}>
            {owner ? 'Delete project' : 'Leave'}
          </Button>
        </>
      }
    />
  );
}
