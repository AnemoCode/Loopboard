import { and, eq } from 'drizzle-orm';
import type { Role } from '@cld/shared';
import type { Db } from './db/index.js';
import { projectMembers } from './db/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export async function getRole(db: Db, projectId: string, userId: string): Promise<Role | null> {
  if (!isUuid(projectId)) return null;
  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}
