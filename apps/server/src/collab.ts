import { Hocuspocus, type Document } from '@hocuspocus/server';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import * as Y from 'yjs';
import { initDoc, repairDoc, toSnapshot, type ProjectSnapshot } from '@cld/model';
import { atLeast, docName, projectIdFromDoc, type Role } from '@cld/shared';
import { getRole } from './access.js';
import { attachChangelog } from './changelog.js';
import type { Auth } from './auth.js';
import type { Db } from './db/index.js';
import { projectDocuments, projects, projectVersions } from './db/schema.js';

export interface CollabContext {
  userId?: string;
  name?: string;
  role?: Role;
  system?: boolean;
  /** Marks a version restore so the changelog logs a single entry. */
  restoreLabel?: string;
  /** Marks an undo of a changelog entry (its summary). */
  undoOf?: string;
}

const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** How many autosaves to keep (≈ 25 hours of editing at the default 5-minute cadence). */
const MAX_AUTO_VERSIONS = 300;

export type Collab = ReturnType<typeof createCollab>;

export function createCollab(
  db: Db,
  auth: Auth,
  log: { warn: (o: object, m: string) => void },
  /** Autosave cadence while people edit. */
  autosaveMs = 5 * 60 * 1000,
) {
  async function loadState(projectId: string): Promise<Uint8Array | null> {
    const rows = await db
      .select({ state: projectDocuments.state })
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .limit(1);
    return rows[0]?.state ?? null;
  }

  async function storeState(projectId: string, doc: Y.Doc, userId: string | null) {
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > MAX_DOC_BYTES) {
      log.warn({ projectId, size: state.byteLength }, 'document exceeds size limit; not stored');
      return;
    }
    const exists = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!exists.length) return; // project was deleted while open
    await db
      .insert(projectDocuments)
      .values({ projectId, state, sizeBytes: state.byteLength })
      .onConflictDoUpdate({
        target: projectDocuments.projectId,
        set: { state, sizeBytes: state.byteLength, updatedAt: new Date() },
      });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    await autosave(projectId, state, userId);
  }

  /** Projects with edits waiting for their next 5-minute autosave. */
  const pendingAutosaves = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Keep a version every 5 minutes while people edit: save now if the last version is older than
   * that, otherwise schedule one for when the 5 minutes are up (so the latest edits are covered too).
   */
  async function autosave(projectId: string, state: Uint8Array, userId: string | null) {
    const [last] = await db
      .select({ createdAt: projectVersions.createdAt })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.createdAt))
      .limit(1);
    const due = last ? last.createdAt.getTime() + autosaveMs : 0;
    if (Date.now() < due) {
      if (!pendingAutosaves.has(projectId)) {
        const timer = setTimeout(
          () => {
            pendingAutosaves.delete(projectId);
            void currentState(projectId)
              .then((s) => s && autosave(projectId, s, userId))
              .catch((err) => log.warn({ err, projectId }, 'autosave failed'));
          },
          due - Date.now() + 250,
        );
        timer.unref();
        pendingAutosaves.set(projectId, timer);
      }
      return;
    }
    const exists = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!exists.length) return;
    await db.insert(projectVersions).values({ projectId, state, kind: 'auto', createdBy: userId });
    const keep = db
      .select({ id: projectVersions.id })
      .from(projectVersions)
      .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.kind, 'auto')))
      .orderBy(desc(projectVersions.createdAt))
      .limit(MAX_AUTO_VERSIONS);
    await db
      .delete(projectVersions)
      .where(
        and(
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.kind, 'auto'),
          notInArray(projectVersions.id, keep),
        ),
      );
  }

  const hocuspocus = new Hocuspocus<CollabContext>({
    debounce: 2000,
    maxDebounce: 10000,
    timeout: 30000,
    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const projectId = projectIdFromDoc(documentName);
      if (!projectId) throw new Error('Not found');
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new Error('Unauthorized');
      const role = await getRole(db, projectId, session.user.id);
      if (!role) throw new Error('Forbidden');
      connectionConfig.readOnly = !atLeast(role, 'editor');
      return { userId: session.user.id, name: session.user.name, role } satisfies CollabContext;
    },
    async onLoadDocument({ document, documentName }) {
      const projectId = projectIdFromDoc(documentName);
      if (!projectId) throw new Error('Not found');
      const state = await loadState(projectId);
      if (state) Y.applyUpdate(document, state);
      initDoc(document);
      repairDoc(document);
      return document;
    },
    async afterLoadDocument({ document, documentName }) {
      const projectId = projectIdFromDoc(documentName);
      if (!projectId) return;
      // Tell connected clients to refresh their History panel after new entries are stored.
      attachChangelog(
        document,
        projectId,
        db,
        () => document.broadcastStateless(JSON.stringify({ type: 'changes' })),
        log,
      );
    },
    async onStoreDocument({ document, documentName, lastContext }) {
      const projectId = projectIdFromDoc(documentName);
      if (projectId) await storeState(projectId, document, lastContext?.userId ?? null);
    },
  });

  /** Apply a change to a project's live document (loads it if nobody has it open). */
  async function withDocument(
    projectId: string,
    fn: (doc: Document) => void,
    actor?: Pick<CollabContext, 'userId' | 'name' | 'restoreLabel' | 'undoOf'>,
  ): Promise<void> {
    // The actor (if any) attributes the change in the changelog.
    const conn = await hocuspocus.openDirectConnection(docName(projectId), {
      system: true,
      ...actor,
    });
    try {
      await conn.transact(fn);
    } finally {
      await conn.disconnect();
    }
  }

  /** Current state: from memory when the document is open, otherwise from the database. */
  async function currentState(projectId: string): Promise<Uint8Array | null> {
    const live = hocuspocus.documents.get(docName(projectId));
    if (live) return Y.encodeStateAsUpdate(live);
    return loadState(projectId);
  }

  async function snapshot(projectId: string): Promise<ProjectSnapshot | null> {
    const state = await currentState(projectId);
    if (!state) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return toSnapshot(doc);
  }

  /** Disconnect a user's sockets (after removal or role change); clients reconnect with fresh permissions. */
  function disconnectUser(projectId: string, userId: string) {
    const doc = hocuspocus.documents.get(docName(projectId));
    for (const c of doc?.getConnections() ?? []) {
      // Close the socket itself: the client reconnects and re-authenticates with its new permissions.
      if ((c.context as CollabContext).userId === userId) c.webSocket.close(4403, 'Access changed');
    }
  }

  /** Ask connected clients to refresh their History panel (e.g. after a version was saved). */
  function notifyChanges(projectId: string) {
    hocuspocus.documents
      .get(docName(projectId))
      ?.broadcastStateless(JSON.stringify({ type: 'changes' }));
  }

  /** Close every connection of a project (deleted). */
  function closeProject(projectId: string) {
    hocuspocus.closeConnections(docName(projectId));
  }

  return {
    hocuspocus,
    notifyChanges,
    withDocument,
    currentState,
    snapshot,
    disconnectUser,
    closeProject,
    storeState,
  };
}
