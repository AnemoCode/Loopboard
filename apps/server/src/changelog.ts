import { isTransactionOrigin, type Document } from '@hocuspocus/server';
import { desc, eq } from 'drizzle-orm';
import { describeChanges, layoutSummary, toSnapshot, type ChangeEntry } from '@cld/model';
import type { Db } from './db/index.js';
import { projectChanges } from './db/schema.js';

/** Who made a transaction: a collaborator's connection, or an API action on their behalf. */
export interface Actor {
  userId: string;
  name: string;
  /** Set when the transaction restores a version (logged as a single entry). */
  restoreLabel?: string;
}

function actorOf(origin: unknown): Actor | null {
  if (!isTransactionOrigin(origin)) return null;
  const ctx = (
    origin.source === 'connection'
      ? origin.connection.context
      : origin.source === 'local'
        ? origin.context
        : null
  ) as { userId?: string; name?: string; restoreLabel?: string } | null;
  if (!ctx?.userId) return null; // server housekeeping (load, migration, repair)
  return {
    userId: ctx.userId,
    name: ctx.name ?? 'Someone',
    ...(ctx.restoreLabel ? { restoreLabel: ctx.restoreLabel } : {}),
  };
}

/** Consecutive moves by the same person within this window become one "rearranged" entry. */
const MERGE_WINDOW_MS = 10 * 60 * 1000;
const MAX_IDS = 500;

/**
 * Track changes of a loaded document: diff each attributed transaction against the previous state
 * and store readable entries. Writes are serialised per document to keep order and merging correct.
 */
export function attachChangelog(
  document: Document,
  projectId: string,
  db: Db,
  onWritten: () => void,
  log: { warn: (o: object, m: string) => void },
) {
  let prev = toSnapshot(document);
  let queue = Promise.resolve();

  document.on('afterTransaction', (tr) => {
    if (tr.changed.size === 0 && tr.deleteSet.clients.size === 0) return;
    const next = toSnapshot(document);
    const before = prev;
    prev = next;
    const actor = actorOf(tr.origin);
    if (!actor) return;
    const entries: ChangeEntry[] = actor.restoreLabel
      ? [{ kind: 'restore', summary: `restored the version ${actor.restoreLabel}` }]
      : describeChanges(before, next);
    if (!entries.length) return;
    queue = queue
      .then(() => persist(db, projectId, actor, entries))
      .then(onWritten)
      .catch((err) => log.warn({ err, projectId }, 'changelog write failed'));
  });
}

async function persist(db: Db, projectId: string, actor: Actor, entries: ChangeEntry[]) {
  for (const e of entries) {
    if (e.kind === 'layout' && e.elementIds?.length) {
      const [last] = await db
        .select()
        .from(projectChanges)
        .where(eq(projectChanges.projectId, projectId))
        .orderBy(desc(projectChanges.id))
        .limit(1);
      if (
        last &&
        last.kind === 'layout' &&
        last.userId === actor.userId &&
        last.diagramId === (e.diagramId ?? null) &&
        last.elementIds.length > 0 &&
        Date.now() - last.createdAt.getTime() < MERGE_WINDOW_MS
      ) {
        const ids = [...new Set([...last.elementIds, ...e.elementIds])].slice(0, MAX_IDS);
        await db
          .update(projectChanges)
          .set({ elementIds: ids, summary: layoutSummary(ids.length), createdAt: new Date() })
          .where(eq(projectChanges.id, last.id));
        continue;
      }
    }
    await db.insert(projectChanges).values({
      projectId,
      userId: actor.userId,
      userName: actor.name,
      kind: e.kind,
      summary: e.summary,
      diagramId: e.diagramId ?? null,
      elementIds: (e.elementIds ?? []).slice(0, MAX_IDS),
    });
  }
}
