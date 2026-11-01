import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Lock, Unlock, Spline } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  findLoops,
  renameVariable,
  updateElement,
  updateVariable,
  type DiagramElement,
  type Link,
  type LoopMarker,
  type Style,
  type VariableNode,
} from '@cld/model';
import { FILL_PALETTE, PALETTE } from '@cld/render';
import { cx, Input, Segmented, Select, Swatches, Textarea } from '../components/ui';
import { applyStyle, editable, patchElements, reorder } from './actions';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { LOCAL } from './session';
import { useEditor } from './store';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-app px-4 py-4 last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Text input that commits on blur/Enter (avoids one undo step per keystroke). */
function CommitInput({ value, onCommit, placeholder, disabled, multiline, ariaLabel }: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  ariaLabel: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  const common = {
    value: v,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (!multiline || e.metaKey)) {
        e.preventDefault();
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === 'Escape') {
        setV(value);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? <Textarea rows={3} {...common} /> : <Input className="h-8" {...common} />;
}

const common = <T,>(values: T[]): T | undefined => (values.length && values.every((v) => v === values[0]) ? values[0] : undefined);

export function DesignPanel() {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const { diagramId, selection } = useEditor();
  const set = useEditor((s) => s.set);
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  const selected = selection.map((id) => diagram?.elements[id]).filter((e): e is DiagramElement => !!e);
  const ids = selected.map((e) => e.id);
  const canChange = editable(ctx, ids).length > 0;

  if (!diagram) return null;
  if (!selected.length) return <DiagramInfo />;

  const types = new Set(selected.map((e) => e.type));
  const only = types.size === 1 ? selected[0]!.type : null;
  const style = (k: keyof Style) => common(selected.map((e) => e.style?.[k]));
  const setStyle = (patch: Style) => applyStyle(ctx, ids, patch);
  const hasText = selected.some((e) => e.type !== 'link');
  const hasBox = selected.some((e) => e.type === 'variable' || e.type === 'shape' || e.type === 'text');
  const locked = selected.every((e) => e.locked);
  const allLinks = selected.every((e) => e.type === 'link');

  return (
    <div className={cx(!canChange && !locked && 'pointer-events-none opacity-60')}>
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-sm font-medium text-app">
          {selected.length > 1 ? `${selected.length} elements` : { variable: 'Variable', link: 'Causal link', loop: 'Loop marker', shape: 'Shape', text: 'Text' }[only!]}
        </span>
        {ctx.canEdit && (
          <button
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-app"
            aria-label={locked ? 'Unlock' : 'Lock'}
            title={locked ? 'Unlock' : 'Lock (prevents moving and editing)'}
            onClick={() =>
              // Lock toggling must also work on locked elements, so it bypasses editable().
              ctx.session.doc.transact(() => ids.forEach((id) => updateElement(ctx.session.doc, diagram.id, id, { locked: locked ? undefined : true })), LOCAL)
            }
          >
            {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </button>
        )}
      </div>

      {only === 'variable' && selected.length === 1 && <VariableSection node={selected[0] as VariableNode} />}
      {only === 'link' && <LinkSection links={selected as Link[]} />}
      {only === 'loop' && selected.length === 1 && <LoopSection loop={selected[0] as LoopMarker} />}

      {(only === 'variable' || only === 'shape') && (
        <Section title="Shape">
          {only === 'variable' ? (
            <Segmented
              value={common(selected.map((e) => (e as VariableNode).form)) ?? null}
              onChange={(form) => patchElements(ctx, ids, { form })}
              options={[
                { value: 'none', label: 'Text' },
                { value: 'rect', label: 'Box' },
                { value: 'rounded', label: 'Round' },
                { value: 'ellipse', label: 'Oval' },
              ]}
            />
          ) : (
            <Segmented
              value={common(selected.map((e) => (e.type === 'shape' ? e.shape : null))) ?? null}
              onChange={(shape) => patchElements(ctx, ids, { shape })}
              options={[
                { value: 'rect', label: 'Rect' },
                { value: 'rounded', label: 'Round' },
                { value: 'ellipse', label: 'Oval' },
                { value: 'diamond', label: 'Diamond' },
              ]}
            />
          )}
        </Section>
      )}

      {hasText && (
        <Section title="Text">
          <Swatches colors={PALETTE} value={style('textColor') as string | undefined} onChange={(c) => setStyle({ textColor: c ?? undefined })} />
          <div className="flex items-center gap-2">
            <Select
              ariaLabel="Font"
              value={(style('fontFamily') as string) ?? 'sans'}
              onChange={(v) => setStyle({ fontFamily: v as Style['fontFamily'] })}
              options={[
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
                { value: 'mono', label: 'Mono' },
              ]}
              className="flex-1"
            />
            <Select
              ariaLabel="Font size"
              value={String(style('fontSize') ?? (only === 'loop' ? '' : 12))}
              onChange={(v) => setStyle({ fontSize: v ? Number(v) : undefined })}
              options={[...(only === 'loop' ? [{ value: '', label: 'Auto' }] : []), ...[10, 11, 12, 14, 16, 18, 20, 24, 32, 40].map((n) => ({ value: String(n), label: String(n) }))]}
              className="w-20"
            />
          </div>
          <div className="flex gap-1">
            <ToggleIcon label="Bold" active={!!style('bold')} onClick={() => setStyle({ bold: style('bold') ? undefined : true })}>
              <Bold className="size-4" />
            </ToggleIcon>
            <ToggleIcon label="Italic" active={!!style('italic')} onClick={() => setStyle({ italic: style('italic') ? undefined : true })}>
              <Italic className="size-4" />
            </ToggleIcon>
            {hasBox && (
              <>
                <span className="mx-1 w-px bg-[var(--border)]" />
                {(['left', 'center', 'right'] as const).map((a) => (
                  <ToggleIcon key={a} label={`Align ${a}`} active={(style('align') ?? (only === 'text' || only === 'variable' || only === 'shape' ? 'center' : '')) === a} onClick={() => setStyle({ align: a })}>
                    {a === 'left' ? <AlignLeft className="size-4" /> : a === 'center' ? <AlignCenter className="size-4" /> : <AlignRight className="size-4" />}
                  </ToggleIcon>
                ))}
              </>
            )}
          </div>
        </Section>
      )}

      {hasBox && (
        <Section title="Fill & border">
          <Row label="Fill">
            <Swatches colors={FILL_PALETTE} allowNone value={style('fill') as string | null | undefined} onChange={(c) => setStyle({ fill: c })} />
          </Row>
          <Row label="Border">
            <Swatches colors={PALETTE} allowNone value={style('stroke') as string | null | undefined} onChange={(c) => setStyle({ stroke: c })} />
          </Row>
          <Row label="Width">
            <div className="flex gap-2">
              <Select
                ariaLabel="Border width"
                value={String(style('strokeWidth') ?? 1.25)}
                onChange={(v) => setStyle({ strokeWidth: Number(v) })}
                options={[0.75, 1.25, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}px` }))}
                className="flex-1"
              />
              <DashSelect value={style('dash') as Style['dash']} onChange={(dash) => setStyle({ dash })} />
            </div>
          </Row>
        </Section>
      )}

      {(allLinks || only === 'loop') && (
        <Section title={allLinks ? 'Arrow' : 'Color'}>
          <Swatches colors={PALETTE} value={style('color') as string | undefined} onChange={(c) => setStyle({ color: c ?? undefined })} />
          <div className="flex gap-2">
            <Select
              ariaLabel="Line width"
              value={String(style('width') ?? (allLinks ? 1.25 : 1.75))}
              onChange={(v) => setStyle({ width: Number(v) })}
              options={[0.75, 1.25, 1.75, 2.5, 3.5].map((n) => ({ value: String(n), label: `${n}px` }))}
              className="flex-1"
            />
            {allLinks && <DashSelect value={style('dash') as Style['dash']} onChange={(dash) => setStyle({ dash })} />}
          </div>
          {allLinks && (
            <Row label="Head">
              <Segmented
                size="sm"
                value={(style('head') as string) ?? 'arrow'}
                onChange={(head) => setStyle({ head: head as Style['head'] })}
                options={[
                  { value: 'arrow', label: 'Filled' },
                  { value: 'open', label: 'Open' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </Row>
          )}
        </Section>
      )}

      <Section title="Arrange">
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(['front', 'back'] as const).map((op) => (
            <button key={op} className="rounded-lg border border-app px-2 py-1.5 text-app hover:bg-surface-2" onClick={() => reorder(ctx, op)}>
              {op === 'front' ? 'Bring to front' : 'Send to back'}
            </button>
          ))}
        </div>
        <button className="w-full rounded-lg border border-app px-2 py-1.5 text-xs text-app hover:bg-surface-2" onClick={() => set({ selection: [] })}>
          Deselect
        </button>
      </Section>
    </div>
  );
}

function ToggleIcon({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx('flex size-8 items-center justify-center rounded-lg', active ? 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300' : 'text-app hover:bg-surface-2')}
    >
      {children}
    </button>
  );
}

function DashSelect({ value, onChange }: { value: Style['dash']; onChange: (d: Style['dash']) => void }) {
  return (
    <Select
      ariaLabel="Line style"
      value={value ?? 'solid'}
      onChange={(v) => onChange(v === 'solid' ? undefined : (v as Style['dash']))}
      options={[
        { value: 'solid', label: 'Solid' },
        { value: 'dashed', label: 'Dashed' },
        { value: 'dotted', label: 'Dotted' },
      ]}
      className="flex-1"
    />
  );
}

function VariableSection({ node }: { node: VariableNode }) {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const v = view.variables[node.variableId];
  if (!v) return null;
  const usages = view.diagrams.filter((d) => Object.values(d.elements).some((e) => e.type === 'variable' && e.variableId === v.id));
  return (
    <Section title="Variable">
      <CommitInput
        ariaLabel="Variable name"
        value={v.name}
        disabled={!ctx.canEdit}
        onCommit={(name) => {
          const res = renameVariable(ctx.session.doc, v.id, name, LOCAL);
          if (!res.ok) toast.error(res.reason === 'duplicate' ? `A variable called “${name.trim()}” already exists` : 'Names cannot be empty');
        }}
      />
      <CommitInput ariaLabel="Units" placeholder="Units (optional)" value={v.units ?? ''} disabled={!ctx.canEdit} onCommit={(units) => updateVariable(ctx.session.doc, v.id, { units }, LOCAL)} />
      <CommitInput ariaLabel="Notes" multiline placeholder="Notes (optional)" value={v.notes ?? ''} disabled={!ctx.canEdit} onCommit={(notes) => updateVariable(ctx.session.doc, v.id, { notes }, LOCAL)} />
      {(node.isShadow || usages.length > 1) && (
        <p className="text-xs text-muted">
          {node.isShadow ? 'Shadow copy. ' : ''}Used in {usages.map((d) => d.name).join(', ')}.
        </p>
      )}
    </Section>
  );
}

function LinkSection({ links }: { links: Link[] }) {
  const ctx = useEditorCtx();
  const ids = links.map((l) => l.id);
  const polarity = common(links.map((l) => l.polarity));
  const delay = links.every((l) => l.delay);
  return (
    <Section title="Polarity">
      <Segmented
        value={polarity === undefined ? null : (polarity ?? 'none')}
        onChange={(p) => patchElements(ctx, ids, { polarity: p === 'none' ? null : p })}
        options={[
          { value: '+', label: <span className="text-base font-bold">+</span>, title: 'Positive (same direction)' },
          { value: '-', label: <span className="text-base font-bold">–</span>, title: 'Negative (opposite direction)' },
          { value: '?', label: <span className="font-bold">?</span>, title: 'Unknown' },
          { value: 'none', label: 'None', title: 'No polarity' },
        ]}
      />
      <label className="flex cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-sm text-app">
        <span>
          Delay mark <span className="text-xs text-muted">(‖)</span>
        </span>
        <input type="checkbox" className="size-4 accent-[var(--ring)]" checked={delay} onChange={(e) => patchElements(ctx, ids, { delay: e.target.checked || undefined })} />
      </label>
      {links.length === 1 && (
        <CommitInput ariaLabel="Link label" placeholder="Label (optional)" value={links[0]!.label ?? ''} disabled={!ctx.canEdit} onCommit={(label) => patchElements(ctx, ids, { label: label.trim() || undefined })} />
      )}
      {links.some((l) => l.control) && (
        <button className="flex items-center gap-1.5 text-xs text-accent-600 hover:underline dark:text-accent-300" onClick={() => patchElements(ctx, ids, { control: null })}>
          <Spline className="size-3.5" /> Straighten
        </button>
      )}
    </Section>
  );
}

function LoopSection({ loop }: { loop: LoopMarker }) {
  const ctx = useEditorCtx();
  return (
    <Section title="Loop">
      <Segmented
        value={loop.kind}
        onChange={(kind) => {
          const prefixed = /^[RB]\d*$/.test(loop.label) && kind !== 'custom';
          patchElements(ctx, [loop.id], { kind, ...(prefixed ? { label: kind + loop.label.slice(1) } : {}) });
        }}
        options={[
          { value: 'R', label: 'Reinforcing', title: 'Reinforcing (R)' },
          { value: 'B', label: 'Balancing', title: 'Balancing (B)' },
          { value: 'custom', label: 'Other' },
        ]}
        size="sm"
      />
      <Row label="Direction">
        <Segmented
          size="sm"
          value={loop.direction}
          onChange={(direction) => patchElements(ctx, [loop.id], { direction })}
          options={[
            { value: 'cw', label: '↻ Clockwise' },
            { value: 'ccw', label: '↺ Counter' },
          ]}
        />
      </Row>
      <Row label="Label">
        <CommitInput ariaLabel="Loop label" value={loop.label} disabled={!ctx.canEdit} onCommit={(label) => patchElements(ctx, [loop.id], { label: label.trim().slice(0, 12) || loop.label })} />
      </Row>
      <Row label="Name">
        <CommitInput ariaLabel="Loop name" placeholder="e.g. Growth engine" value={loop.name ?? ''} disabled={!ctx.canEdit} onCommit={(name) => patchElements(ctx, [loop.id], { name: name.trim() || undefined })} />
      </Row>
    </Section>
  );
}

function DiagramInfo() {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const diagramId = useEditor((s) => s.diagramId);
  const set = useEditor((s) => s.set);
  const d = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  if (!d) return null;
  const els = Object.values(d.elements);
  const count = (t: DiagramElement['type']) => els.filter((e) => e.type === t).length;
  const loops = findLoops(d).loops.length;
  return (
    <div>
      <Section title="Diagram">
        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted">Variables</dt>
          <dd className="text-right font-medium text-app">{count('variable')}</dd>
          <dt className="text-muted">Causal links</dt>
          <dd className="text-right font-medium text-app">{count('link')}</dd>
          <dt className="text-muted">Feedback loops</dt>
          <dd className="text-right font-medium text-app">
            <button className="text-accent-600 hover:underline dark:text-accent-300" onClick={() => set({ panelTab: 'loops' })}>
              {loops}
            </button>
          </dd>
        </dl>
      </Section>
      <Section title="Tips">
        <ul className="space-y-2 text-sm text-muted">
          <li>Double-click the canvas to add a variable.</li>
          <li>Hover a variable and drag a blue dot to draw a link. Drop on empty space to create a new variable.</li>
          <li>Select a link and press <b className="text-app">+</b> or <b className="text-app">–</b> to set its polarity, <b className="text-app">D</b> for a delay.</li>
          <li>Drag the dot in the middle of a link to curve it.</li>
        </ul>
      </Section>
    </div>
  );
}
