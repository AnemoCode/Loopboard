import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { byKey, toSnapshot, type CommentThread, type Diagram, type ProjectSnapshot, type Variable } from '@cld/model';

export interface DocView {
  snapshot: ProjectSnapshot;
  /** Diagrams in tab order. */
  diagrams: Diagram[];
  variables: Record<string, Variable>;
  comments: CommentThread[];
}

/**
 * Plain-object view of the Y.Doc for React. Unchanged elements/variables keep their object
 * identity across updates (structural sharing), so memoised rendering only redoes what changed.
 */
export class DocStore {
  private view: DocView;
  private listeners = new Set<() => void>();
  private prevJson = new WeakMap<object, string>();

  constructor(private doc: Y.Doc) {
    this.view = this.compute(null);
  }

  /**
   * Recompute synchronously after every transaction so React sees the committed state in the same
   * batch as related UI state changes (e.g. clearing a drag gesture) — no one-frame flicker.
   */
  private schedule = () => {
    this.view = this.compute(this.view);
    this.listeners.forEach((l) => l());
  };

  private share<T extends object>(next: T, prev: T | undefined): T {
    if (!prev) return next;
    const a = JSON.stringify(next);
    const b = this.prevJson.get(prev) ?? JSON.stringify(prev);
    if (a === b) return prev;
    this.prevJson.set(next, a);
    return next;
  }

  private compute(prev: DocView | null): DocView {
    const snap = toSnapshot(this.doc);
    if (prev) {
      for (const [id, v] of Object.entries(snap.variables)) snap.variables[id] = this.share(v, prev.snapshot.variables[id]);
      for (const [id, d] of Object.entries(snap.diagrams)) {
        const pd = prev.snapshot.diagrams[id];
        for (const [eid, el] of Object.entries(d.elements)) d.elements[eid] = this.share(el, pd?.elements[eid]);
        for (const [lid, l] of Object.entries(d.layers)) d.layers[lid] = this.share(l, pd?.layers[lid]);
      }
      for (const [id, t] of Object.entries(snap.comments)) snap.comments[id] = this.share(t, prev.snapshot.comments[id]);
    }
    return {
      snapshot: snap,
      diagrams: Object.values(snap.diagrams).sort(byKey((d) => d.order)),
      variables: snap.variables,
      comments: Object.values(snap.comments).sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  get = () => this.view;

  /** Listens to the document only while React components are subscribed (StrictMode-safe). */
  subscribe = (l: () => void) => {
    if (this.listeners.size === 0) {
      this.doc.on('update', this.schedule);
      this.schedule(); // catch up on anything that happened while detached
    }
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
      if (this.listeners.size === 0) this.doc.off('update', this.schedule);
    };
  };
}

export const useDocView = (store: DocStore) => useSyncExternalStore(store.subscribe, store.get);
