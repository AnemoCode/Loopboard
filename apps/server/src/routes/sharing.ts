import { randomBytes } from 'node:crypto';
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  atLeast,
  guestJoinBody,
  inviteBody,
  linkBody,
  linkPatchBody,
  roleBody,
  type InvitableRole,
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

  // ---------------------------------------------------------------- members

  app.get(
    '/api/projects/:id/members',
    async (req): Promise<{ members: Member[]; invites: PendingInvite[] }> => {
      const me = ctx.requireUser(req);
      const { id } = params(req.params);
      const role = await ctx.requireRole(req, id, 'viewer');
      const rows = await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: projectMembers.role,
          isGuest: user.isAnonymous,
        })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, id))
        .orderBy(projectMembers.createdAt);
      // Guests never see email addresses, and guests' placeholder addresses are never shown.
      const members = rows.map((m) => ({ ...m, email: m.isGuest || me.isGuest ? null : m.email }));
      const invites =
        atLeast(role, 'editor') && !me.isGuest
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
    const me = ctx.requireAccount(req);
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { email, role } = inviteBody.parse(req.body);
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email), eq(user.isAnonymous, false)));
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
    ctx.requireAccount(req);
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
    // Anyone may leave; only the owner removes others.
    if (userId !== me.id && myRole !== 'owner')
      throw new HttpError(403, 'Only the owner can remove members');
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId!)));
    collab.disconnectUser(id, userId!);
    return { ok: true };
  });

  app.delete('/api/projects/:id/invites/:inviteId', async (req) => {
    ctx.requireAccount(req);
    const { id, inviteId } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    if (!isUuid(inviteId!)) throw new HttpError(404, 'Invite not found');
    await db
      .delete(projectInvites)
      .where(and(eq(projectInvites.projectId, id), eq(projectInvites.id, inviteId!)));
    return { ok: true };
  });

  // ---------------------------------------------------------------- share links

  /** Guests currently in the project who joined via each link. */
  async function guestCounts(projectId: string): Promise<Map<string, number>> {
    const rows = await db
      .select({ inviteId: projectMembers.inviteId, n: count() })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(user.isAnonymous, true),
          isNotNull(projectMembers.inviteId),
        ),
      )
      .groupBy(projectMembers.inviteId);
    return new Map(rows.map((r) => [r.inviteId!, r.n]));
  }

  const toLink = (
    r: typeof projectInvites.$inferSelect,
    guests: Map<string, number>,
  ): ShareLink => ({
    id: r.id,
    token: r.token!,
    role: r.role as InvitableRole,
    allowGuests: r.allowGuests,
    guestCount: guests.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  });

  app.get('/api/projects/:id/links', async (req): Promise<ShareLink[]> => {
    ctx.requireAccount(req);
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const rows = await db
      .select()
      .from(projectInvites)
      .where(and(eq(projectInvites.projectId, id), isNotNull(projectInvites.token)))
      .orderBy(projectInvites.createdAt);
    const guests = await guestCounts(id);
    return rows.map((r) => toLink(r, guests));
  });

  app.post('/api/projects/:id/links', async (req, reply) => {
    const me = ctx.requireAccount(req);
    const { id } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { role, allowGuests } = linkBody.parse(req.body ?? {});
    const token = randomBytes(24).toString('base64url');
    const [row] = await db
      .insert(projectInvites)
      .values({ projectId: id, token, role, allowGuests, createdBy: me.id })
      .returning();
    return reply.status(201).send(toLink(row!, new Map()));
  });

  const linkWhere = (projectId: string, inviteId: string) =>
    and(
      eq(projectInvites.projectId, projectId),
      eq(projectInvites.id, inviteId),
      isNotNull(projectInvites.token),
    );

  app.patch('/api/projects/:id/links/:inviteId', async (req) => {
    ctx.requireAccount(req);
    const { id, inviteId } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    if (!isUuid(inviteId!)) throw new HttpError(404, 'Link not found');
    const patch = linkPatchBody.parse(req.body ?? {});
    const [row] = await db
      .update(projectInvites)
      .set(patch)
      .where(linkWhere(id, inviteId!))
      .returning();
    if (!row) throw new HttpError(404, 'Link not found');
    return toLink(row, await guestCounts(id));
  });

  /** Revoke a link; `?removeGuests=true` also removes the guests who joined with it. */
  app.delete('/api/projects/:id/links/:inviteId', async (req) => {
    ctx.requireAccount(req);
    const { id, inviteId } = params(req.params);
    await ctx.requireRole(req, id, 'editor');
    if (!isUuid(inviteId!)) throw new HttpError(404, 'Link not found');
    let removed = 0;
    if ((req.query as { removeGuests?: string }).removeGuests === 'true') {
      const guests = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.inviteId, inviteId!),
            eq(user.isAnonymous, true),
          ),
        );
      const ids = guests.map((g) => g.userId);
      if (ids.length) {
        await db
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, id), inArray(projectMembers.userId, ids)));
        for (const g of ids) collab.disconnectUser(id, g);
      }
      removed = ids.length;
    }
    await db.delete(projectInvites).where(linkWhere(id, inviteId!));
    return { ok: true, removedGuests: removed };
  });

  // ---------------------------------------------------------------- joining

  async function findLink(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
      throw new HttpError(404, 'This link is invalid or was revoked');
    const [row] = await db
      .select({
        id: projectInvites.id,
        projectId: projectInvites.projectId,
        role: projectInvites.role,
        allowGuests: projectInvites.allowGuests,
        projectName: projects.name,
        invitedBy: user.name,
      })
      .from(projectInvites)
      .innerJoin(projects, eq(projects.id, projectInvites.projectId))
      .leftJoin(user, eq(user.id, projectInvites.createdBy))
      .where(eq(projectInvites.token, token));
    if (!row) throw new HttpError(404, 'This link is invalid or was revoked');
    return row;
  }

  /** Add a membership via a link; never downgrades an existing role. */
  async function joinVia(link: Awaited<ReturnType<typeof findLink>>, userId: string) {
    const current = await getRole(db, link.projectId, userId);
    if (!current) {
      await db
        .insert(projectMembers)
        .values({ projectId: link.projectId, userId, role: link.role, inviteId: link.id });
    } else if (!atLeast(current, link.role)) {
      await db
        .update(projectMembers)
        .set({ role: link.role })
        .where(
          and(eq(projectMembers.projectId, link.projectId), eq(projectMembers.userId, userId)),
        );
      collab.disconnectUser(link.projectId, userId);
    }
  }

  const tokenOf = (req: FastifyRequest) => (req.params as { token: string }).token;
  const limited = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  /** Public preview: works without signing in, so guests can see what they're joining. */
  app.get('/api/invites/:token', limited, async (req): Promise<InvitePreview> => {
    const link = await findLink(tokenOf(req));
    const me = req.user;
    return {
      projectId: link.projectId,
      projectName: link.projectName,
      role: link.role as InvitableRole,
      invitedBy: link.invitedBy?.split(' ')[0] ?? 'Someone',
      allowGuests: link.allowGuests,
      viewer: me
        ? {
            name: me.name,
            isGuest: me.isGuest,
            alreadyMember: !!(await getRole(db, link.projectId, me.id)),
          }
        : null,
    };
  });

  app.post('/api/invites/:token/accept', limited, async (req) => {
    const me = ctx.requireUser(req);
    const link = await findLink(tokenOf(req));
    if (me.isGuest && !link.allowGuests) throw new HttpError(403, 'This link requires an account');
    await joinVia(link, me.id);
    return { projectId: link.projectId };
  });

  /**
   * Join as a guest with just a name. Reuses the browser's guest session if there is one,
   * otherwise creates an anonymous user and sets its session cookie.
   */
  app.post(
    '/api/invites/:token/guest',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const link = await findLink(tokenOf(req));
      const { name } = guestJoinBody.parse(req.body ?? {});
      let userId = req.user?.id;
      if (req.user && !req.user.isGuest) {
        await joinVia(link, req.user.id);
        return { projectId: link.projectId };
      }
      if (!link.allowGuests) throw new HttpError(403, 'This link requires an account');
      if (!userId) {
        const { headers, response } = await ctx.auth.api.signInAnonymous({
          headers: ctx.headersOf(req),
          returnHeaders: true,
        });
        userId = response.user.id;
        const cookies = headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
      }
      await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId));
      await joinVia(link, userId);
      return { projectId: link.projectId };
    },
  );
}
