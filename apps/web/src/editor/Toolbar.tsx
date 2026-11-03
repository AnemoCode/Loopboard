import {
  ArrowUpRight,
  Circle,
  Diamond,
  Hand,
  Hexagon,
  MessageCircle,
  MousePointer2,
  RectangleHorizontal,
  RefreshCw,
  Square,
  Type,
  Variable,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ShapeKind } from '@cld/model';
import {
  cx,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Tooltip,
} from '../components/ui';
import { useEditorCtx } from './context';
import { useEditor, type Tool } from './store';

const SHAPES: { kind: ShapeKind; label: string; icon: ReactNode }[] = [
  { kind: 'rect', label: 'Rectangle', icon: <Square className="size-4" /> },
  { kind: 'rounded', label: 'Rounded rectangle', icon: <RectangleHorizontal className="size-4" /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <Circle className="size-4" /> },
  { kind: 'diamond', label: 'Diamond', icon: <Diamond className="size-4" /> },
  { kind: 'hexagon', label: 'Hexagon', icon: <Hexagon className="size-4 rotate-90" /> },
];

export function Toolbar() {
  const { canEdit, canComment } = useEditorCtx();
  const tool = useEditor((s) => s.tool);
  const shapeKind = useEditor((s) => s.shapeKind);
  const set = useEditor((s) => s.set);
  const pick = (t: Tool) => set({ tool: t, editing: null });
  const btn = (t: Tool, label: string, key: string, icon: ReactNode, enabled = true) =>
    enabled && (
      <IconButton
        key={t}
        label={label}
        shortcut={key}
        side="right"
        active={tool === t}
        onClick={() => pick(t)}
      >
        {icon}
      </IconButton>
    );
  const shape = SHAPES.find((s) => s.kind === shapeKind)!;
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      className="pointer-events-auto flex flex-col gap-0.5 rounded-2xl border border-app bg-surface p-1 shadow-lg"
    >
      {btn('select', 'Select', 'V', <MousePointer2 className="size-[18px]" />)}
      {btn('hand', 'Pan', 'H', <Hand className="size-[18px]" />)}
      {canEdit && <div className="mx-2 my-1 h-px bg-[var(--border)]" />}
      {btn('variable', 'Variable', 'N', <Variable className="size-[18px]" />, canEdit)}
      {btn('link', 'Causal link', 'L', <ArrowUpRight className="size-[18px]" />, canEdit)}
      {btn('loop', 'Loop marker', 'O', <RefreshCw className="size-[18px]" />, canEdit)}
      {canEdit && (
        <Menu>
          <Tooltip content={shape.label} shortcut="R" side="right">
            <MenuTrigger asChild>
              <button
                aria-label="Shapes"
                onPointerDown={(e) => {
                  // Plain click picks the tool; the menu opens on a long press or via the corner.
                  if (tool !== 'shape') {
                    e.preventDefault();
                    pick('shape');
                  }
                }}
                className={cx(
                  'relative inline-flex size-9 items-center justify-center rounded-lg transition-colors',
                  tool === 'shape'
                    ? 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300'
                    : 'text-app hover:bg-surface-2',
                )}
              >
                {shape.icon}
                <span className="absolute bottom-1 right-1 size-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-50 rotate-[270deg]" />
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent side="right" align="start">
            {SHAPES.map((s) => (
              <MenuItem
                key={s.kind}
                icon={s.icon}
                checked={false}
                onSelect={() => set({ shapeKind: s.kind, tool: 'shape' })}
              >
                {s.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      {btn('text', 'Text', 'T', <Type className="size-[18px]" />, canEdit)}
      {canComment && <div className="mx-2 my-1 h-px bg-[var(--border)]" />}
      {btn('comment', 'Comment', 'C', <MessageCircle className="size-[18px]" />, canComment)}
    </div>
  );
}
