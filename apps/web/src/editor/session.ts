import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { repairDoc, roots } from '@cld/model';
import { colorForUser, docName, type Me } from '@cld/shared';

/** Transaction origin of this user's own edits (tracked by the undo manager). */
export const LOCAL = { local: true };

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'offline' | 'denied';

export interface Session {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  undo: Y.UndoManager;
  user: { id: string; name: string; color: string; guest?: boolean };
  status: SyncStatus;
  /** True once the first sync completed. */
  ready: boolean;
  readOnly: boolean;
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

export function createSession(projectId: string, me: Me): Session {
  const doc = new Y.Doc();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const r = roots(doc);
  const undo = new Y.UndoManager([r.diagrams, r.variables], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: 0,
  });

  const session: Session = {
    doc,
    undo,
    user: {
      id: me.id,
      name: me.name,
      color: colorForUser(me.id),
      ...(me.isGuest ? { guest: true } : {}),
    },
    status: 'connecting',
    ready: false,
    readOnly: true,
    provider: null as unknown as HocuspocusProvider,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      session.provider.destroy();
      undo.destroy();
      doc.destroy();
      listeners.clear();
    },
  };

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let unsynced = 0;
  const updateStatus = (status: SyncStatus) => {
    if (session.status !== status) {
      session.status = status;
      emit();
    }
  };

  session.provider = new HocuspocusProvider({
    url: `${proto}://${window.location.host}/collab`,
    name: docName(projectId),
    document: doc,
    // The session cookie authenticates the socket; the token only triggers the auth handshake.
    token: 'session',
    onAuthenticated: ({ scope }) => {
      session.readOnly = scope === 'readonly';
      if (session.status === 'denied') session.status = 'connecting';
      emit();
    },
    onAuthenticationFailed: () => updateStatus('denied'),
    onSynced: () => {
      if (!session.ready) {
        session.ready = true;
        // Remote edits can break invariants (e.g. a link to a node someone deleted); repair locally.
        doc.on('afterTransaction', (tr) => {
          if (!tr.local && !session.readOnly) queueMicrotask(() => repairDoc(doc));
        });
        if (!session.readOnly) repairDoc(doc);
      }
      updateStatus(unsynced > 0 ? 'saving' : 'synced');
    },
    onUnsyncedChanges: ({ number }) => {
      unsynced = number;
      if (session.status === 'synced' || session.status === 'saving')
        updateStatus(number > 0 ? 'saving' : 'synced');
    },
    onStatus: ({ status }) => {
      if (status === WebSocketStatus.Disconnected && session.status !== 'denied')
        updateStatus('offline');
      if (status === WebSocketStatus.Connecting && session.status === 'offline')
        updateStatus('connecting');
    },
  });
  return session;
}
