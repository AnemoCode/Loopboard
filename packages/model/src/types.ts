/**
 * Plain-JSON shape of a project document. The Yjs document mirrors this
 * structure 1:1 (see `doc.ts`), so `Y.Doc → toJSON()` yields a ProjectSnapshot.
 */

export const SCHEMA_VERSION = 1;

export interface Point {
  x: number;
  y: number;
}

/** Hex color `#rrggbb`. Unset style fields fall back to the theme. */
export type Color = string;

export type FontFamily = 'sans' | 'serif' | 'mono';
export type Dash = 'solid' | 'dashed' | 'dotted';

export interface NodeStyle {
  fill?: Color | null;
  stroke?: Color | null;
  strokeWidth?: number;
  dash?: Dash;
  textColor?: Color;
  fontFamily?: FontFamily;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface LinkStyle {
  color?: Color;
  width?: number;
  dash?: Dash;
  head?: 'arrow' | 'open' | 'none';
  /** Which side of the line the polarity sign sits on: outside the curve (default) or inside it. */
  polaritySide?: 'outside' | 'inside';
}

export type Style = NodeStyle & LinkStyle;

/** Raw Vensim fields kept for lossless `.mdl` round-trips. */
export interface MdlElementInfo {
  sketchId?: number;
  fields?: string[];
  text?: string;
  /** Original quoted/unquoted name as written in the sketch line. */
  rawName?: string;
}

interface ElementBase {
  id: string;
  layerId: string;
  /** Fractional index (z-order within its layer). */
  z: string;
  locked?: boolean;
  style?: Style;
  mdl?: MdlElementInfo;
}

export type NodeForm = 'none' | 'rect' | 'rounded' | 'ellipse';

export interface VariableNode extends ElementBase {
  type: 'variable';
  variableId: string;
  /** Center. */
  x: number;
  y: number;
  /** Minimum box size; the rendered box grows to fit its text. */
  w: number;
  h: number;
  form: NodeForm;
  /** Ghost copy of a variable whose primary node is elsewhere. */
  isShadow?: boolean;
}

export type Polarity = '+' | '-' | '?' | null;

export interface Link extends ElementBase {
  type: 'link';
  from: string;
  to: string;
  /** null = straight line; otherwise the arc passes through this point (Vensim model). */
  control: Point | null;
  polarity: Polarity;
  delay?: boolean;
  label?: string;
}

export type LoopKind = 'R' | 'B' | 'custom';

export interface LoopMarker extends ElementBase {
  type: 'loop';
  x: number;
  y: number;
  /** Half size of the marker's box, like Vensim. */
  r: number;
  kind: LoopKind;
  label: string;
  name?: string;
  direction: 'cw' | 'ccw';
}

export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'diamond';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

export interface TextElement extends ElementBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export type DiagramElement = VariableNode | Link | LoopMarker | ShapeElement | TextElement;
export type ElementType = DiagramElement['type'];

export interface Layer {
  id: string;
  name: string;
  order: string;
  visible: boolean;
  locked: boolean;
}

export interface Diagram {
  id: string;
  name: string;
  order: string;
  layers: Record<string, Layer>;
  elements: Record<string, DiagramElement>;
  mdl?: {
    viewLine?: string;
    headerLine?: string;
    /** Sketch objects we can't represent (valves, images, …), written back verbatim. */
    unknown?: { sketchId: number; lines: string[] }[];
  };
}

export interface Variable {
  id: string;
  name: string;
  units?: string;
  notes?: string;
  mdl?: {
    /** Original equation block, written back verbatim while name & causes are unchanged. */
    equation?: string;
    name?: string;
    causesKey?: string;
    order?: number;
    /** Defined in the equations but not placed in any view; kept so exports stay complete. */
    unplaced?: boolean;
  };
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  editedAt?: number;
}

export interface CommentThread {
  id: string;
  diagramId: string;
  /** Anchored to an element (follows it) or a fixed canvas position. */
  elementId?: string;
  x: number;
  y: number;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
  messages: CommentMessage[];
}

export interface VensimMeta {
  preamble?: string;
  controlSection?: string;
  sketchHeader?: string;
  settings?: string;
  lineEnding?: '\n' | '\r\n';
}

export interface ProjectMeta {
  schemaVersion: number;
  vensim?: VensimMeta;
}

export interface ProjectSnapshot {
  meta: ProjectMeta;
  variables: Record<string, Variable>;
  diagrams: Record<string, Diagram>;
  comments: Record<string, CommentThread>;
}
