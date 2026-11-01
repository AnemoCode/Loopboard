import { Hocuspocus, type Document } from '@hocuspocus/server';
import { and, desc, eq, gt, notInArray } from 'drizzle-orm';
import * as Y from 'yjs';
import { initDoc, repairDoc, toSnapshot, type ProjectSnapshot } from '@cld/model';
import { atLeast, docName, projectIdFromDoc, type Role } from '@cld/shared';
import { getRole } from './access.js';
import type { Auth } from './auth.js';
import type { Db } from './db/index.js';
import { projectDocuments, projects, projectVersions } from './db/schema.js';

export interface CollabContext {
  userId?: string;
  name?: string;
  role?: Role;
  system?: boolean;
}

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
const MAX_AUTO_VERSIONS = 100;

export type Collab = ReturnType<typeof createCollab>;

export function createCollab(db: Db, auth: Auth, log: { warn: (o: object, m: string) => void }) {
  async function loadState(projectId: string): Promise<Uint8Array | null> {
    const rows = await db.select({ state: projectDocuments.state }).from(projectDocuments).where(eq(projectDocuments.projectId, projectId)).limit(1);
    return rows[0]?.state ?? null;
  }

  async function storeState(projectId: string, doc: Y.Doc, userId: string | null) {
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > MAX_DOC_BYTES) {
      log.warn({ projectId, size: state.byteLength }, 'document exceeds size limit; not stored');
      return;
    }
    const exists = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!exists.length) return; // project was deleted while open
    await db
      .insert(projectDocuments)
      .values({ projectId, state, sizeBytes: state.byteLength })
      .onConflictDoUpdate({ target: projectDocuments.projectId, set: { state, sizeBytes: state.byteLength, updatedAt: new Date() } });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    // Automatic version at most every 10 minutes of activity; keep the latest 100.
    const recent = await db
      .select({ id: projectVersions.id })
      .from(projectVersions)
      .where(and(eq(projectVersions.projectId, projectId), gt(projectVersions.createdAt, new Date(Date.now() - AUTO_VERSION_INTERVAL_MS))))
      .limit(1);
    if (!recent.length) {
      await db.insert(projectVersions).values({ projectId, state, kind: 'auto', createdBy: userId });
      const keep = db
        .select({ id: projectVersions.id })
        .from(projectVersions)
        .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.kind, 'auto')))
        .orderBy(desc(projectVersions.createdAt))
        .limit(MAX_AUTO_VERSIONS);
      await db
        .delete(projectVersions)
        .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.kind, 'auto'), notInArray(projectVersions.id, keep)));
    }
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
    async onStoreDocument({ document, documentName, lastContext }) {
      const projectId = projectIdFromDoc(documentName);
      if (projectId) await storeState(projectId, document, lastContext?.userId ?? null);
    },
  });

  /** Apply a change to a project's live document (loads it if nobody has it open). */
  async function withDocument(projectId: string, fn: (doc: Document) => void): Promise<void> {
    const conn = await hocuspocus.openDirectConnection(docName(projectId), { system: true });
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
      if ((c.context as CollabContext).userId === userId) c.close({ code: 4403, reason: 'Access changed' } as CloseEvent);
    }
  }

  /** Close every connection of a project (deleted). */
  function closeProject(projectId: string) {
    hocuspocus.closeConnections(docName(projectId));
  }

  return { hocuspocus, withDocument, currentState, snapshot, disconnectUser, closeProject, storeState };
}


