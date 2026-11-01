import * as Y from 'yjs';
import type {
  CommentThread,
  Diagram,
  DiagramElement,
  Layer,
  ProjectSnapshot,
  Variable,
} from './types.js';

export type YMap = Y.Map<unknown>;

/** Root collections of a project document. */
export function roots(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>('meta'),
    variables: doc.getMap<YMap>('variables'),
    diagrams: doc.getMap<YMap>('diagrams'),
    comments: doc.getMap<YMap>('comments'),
  };
}

/** Keys whose (object) values are stored as nested Y.Maps so concurrent edits merge per property. */
const NESTED_MAP_KEYS = new Set(['style']);

export function plainToYMap(obj: object): YMap {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (NESTED_MAP_KEYS.has(key) && value && typeof value === 'object') {
      map.set(key, plainToYMap(value as object));
    } else {
      map.set(key, value);
    }
  }
  return map;
}

export const elementToY = (el: DiagramElement): YMap => plainToYMap(el);
export const variableToY = (v: Variable): YMap => plainToYMap(v);
export const layerToY = (l: Layer): YMap => plainToYMap(l);

export function diagramToY(d: Diagram): YMap {
  const map = new Y.Map<unknown>();
  map.set('id', d.id);
  map.set('name', d.name);
  map.set('order', d.order);
  if (d.mdl) map.set('mdl', d.mdl);
  const layers = new Y.Map<YMap>();
  for (const l of Object.values(d.layers)) layers.set(l.id, layerToY(l));
  map.set('layers', layers);
  const elements = new Y.Map<YMap>();
  for (const el of Object.values(d.elements)) elements.set(el.id, elementToY(el));
  map.set('elements', elements);
  return map;
}

export function threadToY(t: CommentThread): YMap {
  const { messages, ...rest } = t;
  const map = plainToYMap(rest);
  const arr = new Y.Array<unknown>();
  arr.push(messages);
  map.set('messages', arr);
  return map;
}

export function toSnapshot(doc: Y.Doc): ProjectSnapshot {
  const r = roots(doc);
  return {
    meta: r.meta.toJSON() as ProjectSnapshot['meta'],
    variables: r.variables.toJSON() as ProjectSnapshot['variables'],
    diagrams: r.diagrams.toJSON() as ProjectSnapshot['diagrams'],
    comments: r.comments.toJSON() as ProjectSnapshot['comments'],
  };
}

export function getDiagramY(doc: Y.Doc, diagramId: string): YMap | undefined {
  return roots(doc).diagrams.get(diagramId);
}

export function getElementsY(doc: Y.Doc, diagramId: string): Y.Map<YMap> | undefined {
  return getDiagramY(doc, diagramId)?.get('elements') as Y.Map<YMap> | undefined;
}

export function getLayersY(doc: Y.Doc, diagramId: string): Y.Map<YMap> | undefined {
  return getDiagramY(doc, diagramId)?.get('layers') as Y.Map<YMap> | undefined;
}
