import { and, eq, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import { reassignCommentAuthor } from '@cld/model';
import { atLeast, type Role } from '@cld/shared';
import type { Collab } from './collab.js';
import type { Db } from './db/index.js';
import {
  projectChanges,
  projectMembers,
  projects,
  projectVersions,
  session,
  user,
} from './db/schema.js';

/**
 * A guest created an account (or signed in to one): move their projects, memberships, version
 * authorship and comment authorship to the account. Runs before Better Auth deletes the guest user
 * (which would otherwise delete the projects the guest owns, via the owner_id cascade).
 */
export async function migrateGuest(
  db: Db,
  collab: Collab,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  const memberships = await db.select().from(projectMembers).where(eq(projectMembers.userId, from));
  for (const m of memberships) {
    const [existing] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, m.projectId), eq(projectMembers.userId, to)));
    if (!existing) {
      await db.insert(projectMembers).values({ projectId: m.projectId, userId: to, role: m.role });
    } else if (!atLeast(existing.role as Role, m.role as Role)) {
      // Keep the higher of the two roles.
      await db
        .update(projectMembers)
        .set({ role: m.role })
        .where(and(eq(projectMembers.projectId, m.projectId), eq(projectMembers.userId, to)));
    }
  }
  await db.update(projects).set({ ownerId: to }).where(eq(projects.ownerId, from));
  await db
    .update(projectVersions)
    .set({ createdBy: to })
    .where(eq(projectVersions.createdBy, from));
  await db.update(projectChanges).set({ userId: to }).where(eq(projectChanges.userId, from));
  for (const m of memberships) {
    await collab.withDocument(m.projectId, (doc) => void reassignCommentAuthor(doc, from, to));
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Delete guests who no longer belong to any project (after a day's grace) or whose sessions have all
 * expired: nobody can sign in as them again. Projects they own go with them (owner_id cascade) —
 * guests can't share, so nobody else loses access. Comments keep the author's name, which is stored
 * in the document.
 */
export async function cleanupGuests(db: Db): Promise<number> {
  const dayAgo = new Date(Date.now() - DAY);
  const orphaned = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isAnonymous, true),
        lt(user.createdAt, dayAgo),
        notExists(
          db
            .select({ one: sql`1` })
            .from(projectMembers)
            .where(eq(projectMembers.userId, user.id)),
        ),
      ),
    );
  const expired = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isAnonymous, true),
        lt(user.createdAt, dayAgo),
        notExists(
          db
            .select({ one: sql`1` })
            .from(session)
            .where(and(eq(session.userId, user.id), gt(session.expiresAt, new Date()))),
        ),
      ),
    );
  const ids = [...new Set([...orphaned, ...expired].map((u) => u.id))];
  if (ids.length) await db.delete(user).where(inArray(user.id, ids));
  return ids.length;
}
