import { useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { byKey, type ProjectSnapshot } from '@cld/model';
import { lightTheme, renderDiagramSvg } from '@cld/render';
import { Button, cx, Dialog, Input, Kbd, Segmented, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, useVersions } from '../lib/queries';
import { timeAgo } from '../lib/time';
import { CommandPalette } from './CommandPalette';
import { ShareDialog } from './ShareDialog';
import { useEditorCtx } from './context';
import { mdlPreflight, runExport, type ExportFormat, type ExportOptions } from './exporting';
import { useEditor } from './store';

export function EditorDialogs() {
  const dialog = useEditor((s) => s.dialog);
  const set = useEditor((s) => s.set);
  const close = (o: boolean) => !o && set({ dialog: null });
  return (
    <>
      {dialog === 'share' && <ShareDialog onOpenChange={close} />}
      {dialog === 'export' && <ExportDialog onOpenChange={close} />}
      {dialog === 'versions' && <VersionsDialog onOpenChange={close} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onOpenChange={close} />}
      <CommandPalette />
    </>
  );
}

// ---------------------------------------------------------------- export

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'png', label: 'PNG', hint: 'Image for slides and reports' },
  { value: 'svg', label: 'SVG', hint: 'Scalable vector image' },
  { value: 'pdf', label: 'PDF', hint: 'Vector document, one page per diagram' },
  { value: 'mdl', label: 'Vensim', hint: 'Vensim .mdl model with all diagrams as views' },
  { value: 'json', label: 'Loopwise', hint: 'Lossless .cld.json backup' },
];

function ExportDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const { store, projectName } = useEditorCtx();
  const { diagramId, selection } = useEditor();
  const [o, setO] = useState<ExportOptions>({
    format: 'png',
    scope: 'diagram',
    scale: 2,
    background: 'white',
    dark: false,
    includeHidden: false,
  });
  const [busy, setBusy] = useState(false);
  const snap = store.get().snapshot;
  const visual = o.format === 'png' || o.format === 'svg' || o.format === 'pdf';
  const warnings = useMemo(() => (o.format === 'mdl' ? mdlPreflight(snap) : []), [o.format, snap]);
  const preview = useMemo(() => {
    if (!diagramId || !visual) return null;
    try {
      return renderDiagramSvg(snap, diagramId, {
        theme: o.dark ? undefined : lightTheme,
        background: null,
        includeHidden: o.includeHidden,
        only: o.scope === 'selection' && selection.length ? new Set(selection) : undefined,
      }).svg;
    } catch {
      return null;
    }
  }, [snap, diagramId, visual, o.dark, o.includeHidden, o.scope, selection]);

  const go = async () => {
    setBusy(true);
    try {
      await runExport(snap, projectName, diagramId!, selection, o);
      onOpenChange(false);
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const opt = (label: string, control: ReactNode) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-app">{label}</span>
      <div className="w-56">{control}</div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Export"
      wide
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={go}>
            Download {FORMATS.find((f) => f.value === o.format)!.label}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-5 gap-2">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            onClick={() =>
              setO({
                ...o,
                format: f.value,
                scope:
                  f.value === 'mdl' || f.value === 'json'
                    ? 'all'
                    : o.scope === 'all' && f.value !== 'pdf'
                      ? 'diagram'
                      : o.scope,
              })
            }
            className={cx(
              'rounded-xl border px-2 py-2.5 text-sm font-medium',
              o.format === f.value
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300'
                : 'border-app text-app hover:bg-surface-2',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{FORMATS.find((f) => f.value === o.format)!.hint}</p>

      {visual && (
        <div className="mt-5 space-y-3">
          {preview && (
            <div
              className={cx(
                'flex h-40 items-center justify-center overflow-hidden rounded-xl border border-app p-3',
                o.dark ? 'bg-[#1c1b1a]' : 'bg-white',
                o.background === 'transparent' &&
                  'bg-[repeating-conic-gradient(#e7e5e4_0%_25%,transparent_0%_50%)] [background-size:16px_16px]',
              )}
            >
              <img
                alt="Export preview"
                className="max-h-full max-w-full"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`}
              />
            </div>
          )}
          {opt(
            'Content',
            <Segmented
              size="sm"
              value={o.scope}
              onChange={(scope) => setO({ ...o, scope })}
              options={[
                { value: 'diagram', label: 'Diagram' },
                ...(selection.length ? [{ value: 'selection' as const, label: 'Selection' }] : []),
                { value: 'all', label: 'All diagrams' },
              ]}
            />,
          )}
          {o.format === 'png' &&
            opt(
              'Resolution',
              <Segmented
                size="sm"
                value={String(o.scale)}
                onChange={(s) => setO({ ...o, scale: Number(s) })}
                options={[1, 2, 4].map((n) => ({ value: String(n), label: `${n}×` }))}
              />,
            )}
          {opt(
            'Background',
            <Segmented
              size="sm"
              value={o.background === 'theme' ? 'white' : o.background}
              onChange={(background) => setO({ ...o, background })}
              options={[
                { value: 'white', label: 'Solid' },
                ...(o.format !== 'pdf'
                  ? [{ value: 'transparent' as const, label: 'Transparent' }]
                  : []),
              ]}
            />,
          )}
          {opt(
            'Colors',
            <Segmented
              size="sm"
              value={o.dark ? 'dark' : 'light'}
              onChange={(v) => setO({ ...o, dark: v === 'dark' })}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />,
          )}
          <label className="flex items-center justify-between text-sm text-app">
            Include hidden layers
            <input
              type="checkbox"
              className="size-4 accent-[var(--ring)]"
              checked={o.includeHidden}
              onChange={(e) => setO({ ...o, includeHidden: e.target.checked })}
            />
          </label>
        </div>
      )}
      {o.format === 'mdl' && warnings.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" /> Some styling has no Vensim equivalent
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {o.format === 'mdl' && warnings.length === 0 && (
        <p className="mt-5 text-sm text-muted">
          Everything in this project can be represented in Vensim.
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- versions

function VersionsDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const { projectId, canEdit } = useEditorCtx();
  const versions = useVersions(projectId);
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; svg: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const select = async (id: string) => {
    setSelected(id);
    setPreview(null);
    try {
      const snap = await api<ProjectSnapshot>(`/projects/${projectId}/versions/${id}/snapshot`);
      const first = Object.values(snap.diagrams).sort(byKey((d) => d.order))[0];
      const svg =
        first && Object.keys(first.elements).length
          ? renderDiagramSvg(snap, first.id, { theme: lightTheme, background: null }).svg
          : null;
      setPreview({ id, svg });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const save = async () => {
    if (!label.trim()) return;
    try {
      await api(`/projects/${projectId}/versions`, { body: { label: label.trim() } });
      setLabel('');
      await qc.invalidateQueries({ queryKey: keys.versions(projectId) });
      toast.success('Version saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/versions/${selected}/restore`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: keys.versions(projectId) });
      toast.success(
        'Version restored for everyone. The previous state was saved as “Before restore”.',
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const kindLabel = {
    auto: 'Autosave',
    manual: 'Saved',
    import: 'Imported',
    restore: 'Before restore',
  } as const;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Version history"
      description="A version is saved automatically every 5 minutes while people edit."
      wide
    >
      {canEdit && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            placeholder="Name this version, e.g. “Before workshop”"
            aria-label="Version name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
          />
          <Button type="submit" disabled={!label.trim()}>
            Save version
          </Button>
        </form>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {versions.isLoading && <Spinner />}
          {versions.data?.length === 0 && <p className="text-sm text-muted">No versions yet.</p>}
          {versions.data?.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => select(v.id)}
                className={cx(
                  'w-full rounded-lg px-3 py-2 text-left',
                  selected === v.id ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-surface-2',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-app">
                  <History className="size-3.5 text-muted" />
                  {v.label && v.kind === 'manual' ? v.label : kindLabel[v.kind]}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {timeAgo(v.createdAt)}
                  {v.createdByName ? ` · ${v.createdByName}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex min-h-48 flex-col rounded-xl border border-app bg-white p-3">
          {!selected ? (
            <p className="m-auto text-sm text-stone-500">Select a version to preview it.</p>
          ) : !preview ? (
            <Spinner className="m-auto" />
          ) : preview.svg ? (
            <img
              alt="Version preview"
              className="m-auto max-h-64 max-w-full"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
            />
          ) : (
            <p className="m-auto text-sm text-stone-500">This version's first diagram is empty.</p>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Button variant="primary" disabled={!selected} loading={busy} onClick={restore}>
            <RotateCcw className="size-4" /> Restore this version
          </Button>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- shortcuts

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export const SHORTCUTS: [string, string[]][] = [
  ['Select / Pan', ['V', 'H']],
  ['Variable / Causal link / Loop marker', ['N', 'L', 'O']],
  ['Shape / Text / Comment', ['R', 'T', 'C']],
  ['Add variable', ['Double-click']],
  ['Pan the canvas', ['Space + drag']],
  ['Zoom', [`${mod} + scroll`]],
  ['Set polarity of selected links', ['+', '–']],
  ['Cycle polarity / toggle delay', ['P', 'D']],
  ['Edit text of selection', ['Enter']],
  ['Undo / Redo', [`${mod} Z`, `${mod} ⇧ Z`]],
  ['Copy / Paste / Duplicate', [`${mod} C`, `${mod} V`, `${mod} D`]],
  ['Select all', [`${mod} A`]],
  ['Delete', ['⌫']],
  ['Nudge (×10 with Shift)', ['← ↑ → ↓']],
  ['Bring forward / to front', [`${mod} ]`, `${mod} ⇧ ]`]],
  ['Zoom to fit / selection / 100%', ['⇧ 1', '⇧ 2', `${mod} 0`]],
  ['Search variables and commands', [`${mod} K`]],
  ['Export', [`${mod} E`]],
  ['Toggle side panel', [`${mod} .`]],
  ['Keep proportions while resizing / no snapping', ['Shift', 'Alt']],
];

function ShortcutsDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onOpenChange} title="Keyboard shortcuts" wide>
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {SHORTCUTS.map(([label, keysList]) => (
          <li key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-app">{label}</span>
            <span className="flex shrink-0 gap-1">
              {keysList.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
