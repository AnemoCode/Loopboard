import { create } from 'zustand';
import type { Point, ShapeKind } from '@cld/model';

export type Tool = 'select' | 'hand' | 'variable' | 'link' | 'loop' | 'shape' | 'text' | 'comment';

export interface Viewport {
  /** Screen = world * zoom + (x, y). */
  x: number;
  y: number;
  zoom: number;
}

/** Live manipulation in progress. Shared with collaborators through awareness. */
export type Gesture =
  | { kind: 'move'; ids: string[]; dx: number; dy: number }
  | { kind: 'resize'; id: string; x: number; y: number; w: number; h: number }
  | { kind: 'curve'; id: string; control: Point | null }
  | {
      kind: 'link';
      from: string;
      point: Point;
      target: string | null;
      linkId?: string;
      end?: 'from' | 'to';
    }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'draw'; shape: ShapeKind; x0: number; y0: number; x1: number; y1: number };

/** Inline text editing: an existing element, or a variable about to be created. */
export type Editing =
  | { kind: 'element'; id: string }
  | { kind: 'new-variable'; x: number; y: number; linkFrom?: string }
  | { kind: 'new-text'; x: number; y: number };

export type PanelTab = 'design' | 'layers' | 'comments' | 'loops';

interface EditorState {
  diagramId: string | null;
  layerId: string | null;
  tool: Tool;
  shapeKind: ShapeKind;
  selection: string[];
  editing: Editing | null;
  viewport: Viewport;
  gesture: Gesture | null;
  guides: { x?: number; y?: number } | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  /** Links highlighted by the loops panel. */
  highlight: string[];
  openThread: string | null;
  draftComment: { x: number; y: number; elementId?: string } | null;
  followClientId: number | null;
  showResolved: boolean;
  dialog: null | 'share' | 'export' | 'versions' | 'shortcuts' | 'palette';
  /** Incremented to ask the canvas to zoom to fit. */
  fitNonce: number;
  set: (patch: Partial<EditorState>) => void;
  select: (ids: string[]) => void;
  reset: () => void;
}

const initial = {
  diagramId: null,
  layerId: null,
  tool: 'select' as Tool,
  shapeKind: 'rect' as ShapeKind,
  selection: [],
  editing: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  gesture: null,
  guides: null,
  panelOpen: true,
  panelTab: 'design' as PanelTab,
  highlight: [],
  openThread: null,
  draftComment: null,
  followClientId: null,
  showResolved: false,
  dialog: null,
  fitNonce: 0,
};

export const useEditor = create<EditorState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  select: (ids) => set({ selection: ids }),
  reset: () => set({ ...initial, panelOpen: window.innerWidth > 900 }),
}));

export const editor = () => useEditor.getState();
