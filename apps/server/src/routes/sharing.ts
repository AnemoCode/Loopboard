import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  atLeast,
  inviteBody,
  linkBody,
  roleBody,
  type InvitePreview,
  type Member,
  type PendingInvite,
  type ShareLink,
} from '@cld/shared';
import type { Ctx } from '../app.js';
import { getRole, isUuid } from '../access.js';
import { HttpError } from '../errors.js';
import { projectInvites, projectMembers, projects, user } from '../db/schema.js';

const params = (p: unknown) => {
  const { id, userId, inviteId } = p as { id: string; userId?: string; inviteId?: string };
  if (!isUuid(id)) throw new HttpError(404, 'Project not found');
  return { id, userId, inviteId };
};

export async function sharingRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, collab } = ctx;

  app.get(
    '/api/projects/:id/members',
    async (req): Promise<{ members: Member[]; invites: PendingInvite[] }> => {
      const { id } = params(req.params);
      const role = await ctx.requireRole(req, id, 'viewer');
      const members = await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, id))
        .orderBy(projectMembers.createdAt);
      const invites = atLeast(role, 'editor')
        ? await db
            .select()
            .from(projectInvites)
            .where(and(eq(projectInvites.projectId, id), isNull(projectInvites.token)))
            .orderBy(projectInvites.createdAt)
        : [];
      return {
        members,
        invites: invites.map((i) => ({
          id: i.id,
          email: i.email!,
          role: i.role as PendingInvite['role'],
          createdAt: i.createdAt.toISOString(),
        })),
      };
    },
  );

  /** Invite by email: existing users are added right away, others join when they sign up. */
  app.post('/api/projects/:id/members', async (req) => {
    const me = ctx.requireUser(req);
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { email, role } = inviteBody.parse(req.body);
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (existing) {
      const current = await getRole(db, id, existing.id);
      if (current === 'owner') return { status: 'added' as const };
      await db
        .insert(projectMembers)
        .values({ projectId: id, userId: existing.id, role })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { role },
        });
      if (current && current !== role) collab.disconnectUser(id, existing.id);
      return { status: 'added' as const };
    }
    const [pending] = await db
      .select({ id: projectInvites.id })
      .from(projectInvites)
      .where(and(eq(projectInvites.projectId, id), eq(projectInvites.email, email)));
    if (pending)
      await db.update(projectInvites).set({ role }).where(eq(projectInvites.id, pending.id));
    else await db.insert(projectInvites).values({ projectId: id, email, role, createdBy: me.id });
    return { status: 'invited' as const };
  });

  app.patch('/api/projects/:id/members/:userId', async (req) => {
    const { id, userId } = params(req.params);
    await ctx.requireRole(req, id, 'owner');
    const { role } = roleBody.parse(req.body);
    const current = await getRole(db, id, userId!);
    if (!current) throw new HttpError(404, 'Member not found');
    if (current === 'owner') throw new HttpError(400, "The owner's role can't be changed");
    await db
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId!)));
    collab.disconnectUser(id, userId!);
    return { ok: true };
  });

  app.delete('/api/projects/:id/members/:userId', async (req) => {
    const me = ctx.requireUser(req);
    const { id, userId } = params(req.params);
    const myRole = await ctx.requireRole(req, id, 'viewer');
    const target = await getRole(db, id, userId!);
    if (!target) throw new HttpError(404, 'Member not found');
    if (target === 'owner') throw new HttpError(400, "The owner can't be removed");
    if (userId !== me.id && myRole !== 'owner')
      throw new HttpError(403, 'Only the owner can remove members');
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId!)));
    collab.disconnectUser(id, userId!);
    return { ok: true };
  });

  app.delete('/api/projects/:id/invites/:inviteId', async (req) => {
    const { id, inviteId } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    if (!isUuid(inviteId!)) throw new HttpError(404, 'Invite not found');
    await db
      .delete(projectInvites)
      .where(and(eq(projectInvites.projectId, id), eq(projectInvites.id, inviteId!)));
    return { ok: true };
  });

  // ---- share links

  app.get('/api/projects/:id/links', async (req): Promise<ShareLink[]> => {
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const rows = await db
      .select()
      .from(projectInvites)
      .where(and(eq(projectInvites.projectId, id), isNotNull(projectInvites.token)))
      .orderBy(projectInvites.createdAt);
    return rows.map((r) => ({
      id: r.id,
      token: r.token!,
      role: r.role as ShareLink['role'],
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.post('/api/projects/:id/links', async (req, reply) => {
    const me = ctx.requireUser(req);
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { role } = linkBody.parse(req.body);
    const token = randomBytes(24).toString('base64url');
    const [row] = await db
      .insert(projectInvites)
      .values({ projectId: id, token, role, createdBy: me.id })
      .returning();
    return reply
      .status(201)
      .send({
        id: row!.id,
        token,
        role,
        createdAt: row!.createdAt.toISOString(),
      } satisfies ShareLink);
  });

  app.delete('/api/projects/:id/links/:inviteId', async (req) => {
    const { id, inviteId } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    if (!isUuid(inviteId!)) throw new HttpError(404, 'Link not found');
    await db
      .delete(projectInvites)
      .where(
        and(
          eq(projectInvites.projectId, id),
          eq(projectInvites.id, inviteId!),
          isNotNull(projectInvites.token),
        ),
      );
    return { ok: true };
  });

  async function findLink(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
      throw new HttpError(404, 'This invite link is invalid or was revoked');
    const [row] = await db
      .select({
        projectId: projectInvites.projectId,
        role: projectInvites.role,
        projectName: projects.name,
        invitedBy: user.name,
      })
      .from(projectInvites)
      .innerJoin(projects, eq(projects.id, projectInvites.projectId))
      .leftJoin(user, eq(user.id, projectInvites.createdBy))
      .where(eq(projectInvites.token, token));
    if (!row) throw new HttpError(404, 'This invite link is invalid or was revoked');
    return row;
  }

  app.get(
    '/api/invites/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<InvitePreview> => {
      const me = ctx.requireUser(req);
      const row = await findLink((req.params as { token: string }).token);
      const current = await getRole(db, row.projectId, me.id);
      return {
        projectId: row.projectId,
        projectName: row.projectName,
        role: row.role as InvitePreview['role'],
        invitedBy: row.invitedBy ?? 'Someone',
        alreadyMember: !!current,
      };
    },
  );

  app.post(
    '/api/invites/:token/accept',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const me = ctx.requireUser(req);
      const row = await findLink((req.params as { token: string }).token);
      const current = await getRole(db, row.projectId, me.id);
      // Joining via a link never downgrades an existing role.
      if (!current)
        await db
          .insert(projectMembers)
          .values({ projectId: row.projectId, userId: me.id, role: row.role });
      else if (!atLeast(current, row.role)) {
        await db
          .update(projectMembers)
          .set({ role: row.role })
          .where(
            and(eq(projectMembers.projectId, row.projectId), eq(projectMembers.userId, me.id)),
          );
        collab.disconnectUser(row.projectId, me.id);
      }
      return { projectId: row.projectId };
    },
  );
}
