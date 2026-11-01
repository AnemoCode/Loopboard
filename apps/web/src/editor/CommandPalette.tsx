import * as RDialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { addDiagram } from '@cld/model';
import { cx, Kbd } from '../components/ui';
import { setThemePref } from '../lib/theme';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { LOCAL } from './session';
import { useEditor, type Tool } from './store';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Variables' | 'Diagrams' | 'Actions';
  run: () => void;
}

/** ⌘K: search variables (jump to them), diagrams and commands. */
export function CommandPalette() {
  const open = useEditor((s) => s.dialog === 'palette');
  const set = useEditor((s) => s.set);
  return (
    <RDialog.Root open={open} onOpenChange={(o) => set({ dialog: o ? 'palette' : null })}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <RDialog.Content className="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl border border-app bg-surface shadow-2xl animate-pop focus:outline-none">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <RDialog.Description className="sr-only">
            Search variables, diagrams and commands
          </RDialog.Description>
          {open && <PaletteBody close={() => set({ dialog: null })} />}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const set = useEditor((s) => s.set);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    // Variables: jump to (first) placement, preferring the current diagram.
    const current = useEditor.getState().diagramId;
    for (const v of Object.values(view.variables)) {
      const places = view.diagrams.flatMap((d) =>
        Object.values(d.elements)
          .filter((e) => e.type === 'variable' && e.variableId === v.id)
          .map((e) => ({ d, e })),
      );
      const target = places.find((p) => p.d.id === current) ?? places[0];
      if (!target) continue;
      list.push({
        id: `v-${v.id}`,
        label: v.name,
        hint: target.d.name,
        group: 'Variables',
        run: () => {
          const el = target.e as { x: number; y: number; id: string };
          const canvas = document.querySelector('[data-testid="canvas"]')?.getBoundingClientRect();
          const zoom = Math.max(useEditor.getState().viewport.zoom, 1);
          set({
            diagramId: target.d.id,
            selection: [el.id],
            viewport: {
              zoom,
              x: (canvas?.width ?? 800) / 2 - el.x * zoom,
              y: (canvas?.height ?? 600) / 2 - el.y * zoom,
            },
            followClientId: null,
          });
        },
      });
    }
    for (const d of view.diagrams)
      list.push({
        id: `d-${d.id}`,
        label: d.name,
        hint: 'Go to diagram',
        group: 'Diagrams',
        run: () => set({ diagramId: d.id, selection: [] }),
      });
    const tool = (t: Tool, label: string, key: string) => ({
      id: `t-${t}`,
      label,
      hint: key,
      group: 'Actions' as const,
      run: () => set({ tool: t }),
    });
    if (ctx.canEdit) {
      list.push(
        tool('variable', 'Add variable', 'N'),
        tool('link', 'Draw causal link', 'L'),
        tool('loop', 'Add loop marker', 'O'),
        tool('shape', 'Draw shape', 'R'),
        tool('text', 'Add text', 'T'),
      );
      list.push({
        id: 'new-diagram',
        label: 'New diagram',
        group: 'Actions',
        run: () =>
          set({
            diagramId: addDiagram(ctx.session.doc, `Diagram ${view.diagrams.length + 1}`, LOCAL),
            selection: [],
          }),
      });
    }
    if (ctx.canComment) list.push(tool('comment', 'Add comment', 'C'));
    list.push(
      {
        id: 'loops',
        label: 'Show feedback loops',
        group: 'Actions',
        run: () => set({ panelOpen: true, panelTab: 'loops' }),
      },
      {
        id: 'history',
        label: 'Show change history',
        group: 'Actions',
        run: () => set({ panelOpen: true, panelTab: 'history' }),
      },
      {
        id: 'layers',
        label: 'Show layers',
        group: 'Actions',
        run: () => set({ panelOpen: true, panelTab: 'layers' }),
      },
      {
        id: 'fit',
        label: 'Zoom to fit',
        hint: '⇧1',
        group: 'Actions',
        run: () => set({ fitNonce: Date.now() }),
      },
      {
        id: 'export',
        label: 'Export…',
        hint: '⌘E',
        group: 'Actions',
        run: () => set({ dialog: 'export' }),
      },
      { id: 'share', label: 'Share…', group: 'Actions', run: () => set({ dialog: 'share' }) },
      {
        id: 'versions',
        label: 'Version history',
        group: 'Actions',
        run: () => set({ dialog: 'versions' }),
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        hint: '?',
        group: 'Actions',
        run: () => set({ dialog: 'shortcuts' }),
      },
      { id: 'light', label: 'Theme: Light', group: 'Actions', run: () => setThemePref('light') },
      { id: 'dark', label: 'Theme: Dark', group: 'Actions', run: () => setThemePref('dark') },
    );
    return list;
  }, [view, ctx, set]);

  const needle = q.trim().toLowerCase();
  const results = (
    needle
      ? commands.filter((c) => c.label.toLowerCase().includes(needle))
      : commands.filter((c) => c.group !== 'Variables')
  ).slice(0, 40);
  const choose = (c: Command | undefined) => {
    if (!c) return;
    // Close first so dialogs opened by the command aren't immediately replaced.
    close();
    requestAnimationFrame(() => c.run());
  };

  let lastGroup: string | null = null;
  const rows: ReactNode[] = [];
  results.forEach((c, i) => {
    if (c.group !== lastGroup) {
      lastGroup = c.group;
      rows.push(
        <li key={`g-${c.group}`} className="px-3 pb-1 pt-2 text-xs font-medium text-muted">
          {c.group}
        </li>,
      );
    }
    rows.push(
      <li key={c.id}>
        <button
          className={cx(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
            i === active ? 'bg-accent-50 text-app dark:bg-accent-500/15' : 'text-app',
          )}
          onMouseMove={() => setActive(i)}
          onClick={() => choose(c)}
        >
          <span className="flex-1 truncate">{c.label}</span>
          {c.hint &&
            (c.hint.length <= 3 ? (
              <Kbd>{c.hint}</Kbd>
            ) : (
              <span className="truncate text-xs text-muted">{c.hint}</span>
            ))}
        </button>
      </li>,
    );
  });

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-app px-4">
        <Search className="size-4 text-muted" />
        <input
          autoFocus
          aria-label="Search variables and commands"
          placeholder="Search variables, diagrams and commands…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(results[active]);
            }
          }}
          className="h-12 flex-1 bg-transparent text-sm text-app outline-none placeholder:text-[var(--muted)]"
        />
      </div>
      <ul className="max-h-80 overflow-y-auto p-1.5">
        {rows.length ? (
          rows
        ) : (
          <li className="px-3 py-6 text-center text-sm text-muted">No results</li>
        )}
      </ul>
    </div>
  );
}
