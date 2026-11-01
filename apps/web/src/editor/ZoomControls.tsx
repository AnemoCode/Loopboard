import { Maximize, Minus, Plus } from 'lucide-react';
import { IconButton, Tooltip } from '../components/ui';
import { zoomTo } from './actions';
import { useEditor } from './store';

export function ZoomControls({ onFit }: { onFit: () => void }) {
  const viewport = useEditor((s) => s.viewport);
  const set = useEditor((s) => s.set);
  const zoomBy = (f: number) => {
    const el = document.querySelector('[data-testid="canvas"]');
    const r = el?.getBoundingClientRect();
    set({ viewport: zoomTo(viewport, viewport.zoom * f, { x: (r?.width ?? 0) / 2, y: (r?.height ?? 0) / 2 }), followClientId: null });
  };
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-app bg-surface p-1 shadow-lg">
      <IconButton size="sm" label="Zoom out" shortcut="⌘−" side="top" onClick={() => zoomBy(1 / 1.25)}>
        <Minus className="size-4" />
      </IconButton>
      <Tooltip content="Reset to 100%" side="top">
        <button className="w-12 rounded-md py-1 text-xs font-medium tabular-nums text-app hover:bg-surface-2" onClick={() => zoomBy(1 / viewport.zoom)}>
          {Math.round(viewport.zoom * 100)}%
        </button>
      </Tooltip>
      <IconButton size="sm" label="Zoom in" shortcut="⌘+" side="top" onClick={() => zoomBy(1.25)}>
        <Plus className="size-4" />
      </IconButton>
      <IconButton size="sm" label="Zoom to fit" shortcut="⇧1" side="top" onClick={onFit}>
        <Maximize className="size-4" />
      </IconButton>
    </div>
  );
}
