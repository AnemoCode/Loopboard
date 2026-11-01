import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import {
  byKey,
  initDoc,
  replaceContent,
  snapshotSchema,
  toSnapshot,
  type ProjectSnapshot,
} from '@cld/model';
import { renderDiagramSvg } from '@cld/render';
import {
  createProjectBody,
  updateProjectBody,
  versionBody,
  type ChangesPage,
  type ChangeSummary,
  type ProjectSummary,
  type VersionSummary,
} from '@cld/shared';
import type { Ctx } from '../app.js';
import { isUuid } from '../access.js';
import { HttpError } from '../errors.js';
import {
  projectChanges,
  projectDocuments,
  projectMembers,
  projects,
  projectVersions,
  user,
} from '../db/schema.js';

const idParam = (params: unknown) => {
  const id = (params as { id: string }).id;
  if (!isUuid(id)) throw new HttpError(404, 'Project not found');
  return id;
};

function parseSnapshot(raw: unknown): ProjectSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(400, 'The diagram data is invalid', parsed.error.issues[0]?.message);
  return parsed.data as ProjectSnapshot;
}

export async function projectRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, collab } = ctx;

  async function createProject(
    ownerId: string,
    name: string,
    state: Uint8Array,
    versionKind: 'import' | null,
  ) {
    return db.transaction(async (tx) => {
      const [p] = await tx.insert(projects).values({ name, ownerId }).returning();
      await tx.insert(projectMembers).values({ projectId: p!.id, userId: ownerId, role: 'owner' });
      await tx
        .insert(projectDocuments)
        .values({ projectId: p!.id, state, sizeBytes: state.byteLength });
      if (versionKind)
        await tx.insert(projectVersions).values({
          projectId: p!.id,
          state,
          kind: versionKind,
          label: 'Imported',
          createdBy: ownerId,
        });
      return p!;
    });
  }

  app.get('/api/projects', async (req): Promise<ProjectSummary[]> => {
    const me = ctx.requireUser(req);
    const owner = db.$with('owner').as(db.select({ id: user.id, name: user.name }).from(user));
    const rows = await db
      .with(owner)
      .select({
        id: projects.id,
        name: projects.name,
        role: projectMembers.role,
        ownerName: owner.name,
        memberCount: sql<number>`(select count(*)::int from project_members m where m.project_id = ${projects.id})`,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .innerJoin(owner, eq(owner.id, projects.ownerId))
      .where(eq(projectMembers.userId, me.id))
      .orderBy(desc(projects.updatedAt));
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });

  app.post(
    '/api/projects',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const me = ctx.requireAccount(req);
      const body = createProjectBody.parse(req.body);
      const doc = new Y.Doc();
      if (body.snapshot !== undefined) replaceContent(doc, parseSnapshot(body.snapshot));
      else initDoc(doc, 'Main');
      const p = await createProject(
        me.id,
        body.name,
        Y.encodeStateAsUpdate(doc),
        body.snapshot !== undefined ? 'import' : null,
      );
      return reply.status(201).send({ id: p.id });
    },
  );

  app.get('/api/projects/:id', async (req) => {
    const id = idParam(req.params);
    const role = await ctx.requireRole(req, id, 'viewer');
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    if (!p) throw new HttpError(404, 'Project not found');
    return {
      id: p.id,
      name: p.name,
      role,
      ownerId: p.ownerId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  });

  app.patch('/api/projects/:id', async (req) => {
    ctx.requireAccount(req);
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { name } = updateProjectBody.parse(req.body);
    await db.update(projects).set({ name }).where(eq(projects.id, id));
    return { ok: true };
  });

  app.delete('/api/projects/:id', async (req) => {
    ctx.requireAccount(req);
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'owner');
    collab.closeProject(id);
    await db.delete(projects).where(eq(projects.id, id));
    return { ok: true };
  });

  app.post('/api/projects/:id/duplicate', async (req, reply) => {
    const me = ctx.requireAccount(req);
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'viewer');
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    const state = await collab.currentState(id);
    if (!p || !state) throw new HttpError(404, 'Project not found');
    // Comments are not copied.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const snap = toSnapshot(doc);
    snap.comments = {};
    const copy = new Y.Doc();
    replaceContent(copy, snap);
    const created = await createProject(
      me.id,
      `${p.name} (copy)`.slice(0, 200),
      Y.encodeStateAsUpdate(copy),
      null,
    );
    return reply.status(201).send({ id: created.id });
  });

  app.get('/api/projects/:id/thumbnail.svg', async (req, reply) => {
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'viewer');
    const snap = await collab.snapshot(id);
    if (!snap) throw new HttpError(404, 'Project not found');
    const first = Object.values(snap.diagrams).sort(byKey((d) => d.order))[0];
    const empty = !first || Object.keys(first.elements).length === 0;
    const svg = empty
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200"></svg>'
      : renderDiagramSvg(snap, first.id, { background: null, padding: 24 }).svg;
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-cache')
      .send(svg);
  });

  // ---- changelog

  app.get('/api/projects/:id/changes', async (req): Promise<ChangesPage> => {
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'viewer');
    const q = req.query as { before?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const before = Number(q.before);
    const rows = await db
      .select({
        id: projectChanges.id,
        userId: projectChanges.userId,
        // Prefer the person's current name; fall back to the name at the time.
        userName: sql<string>`coalesce(${user.name}, ${projectChanges.userName})`,
        kind: projectChanges.kind,
        summary: projectChanges.summary,
        diagramId: projectChanges.diagramId,
        elementIds: projectChanges.elementIds,
        createdAt: projectChanges.createdAt,
      })
      .from(projectChanges)
      .leftJoin(user, eq(user.id, projectChanges.userId))
      .where(
        Number.isFinite(before) && before > 0
          ? and(eq(projectChanges.projectId, id), lt(projectChanges.id, before))
          : eq(projectChanges.projectId, id),
      )
      .orderBy(desc(projectChanges.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      changes: page.map((r) => ({
        ...r,
        kind: r.kind as ChangeSummary['kind'],
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  });

  // ---- versions

  app.get('/api/projects/:id/versions', async (req): Promise<VersionSummary[]> => {
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'viewer');
    const rows = await db
      .select({
        id: projectVersions.id,
        label: projectVersions.label,
        kind: projectVersions.kind,
        createdBy: projectVersions.createdBy,
        createdByName: user.name,
        createdAt: projectVersions.createdAt,
      })
      .from(projectVersions)
      .leftJoin(user, eq(user.id, projectVersions.createdBy))
      .where(eq(projectVersions.projectId, id))
      .orderBy(desc(projectVersions.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });

  app.post('/api/projects/:id/versions', async (req, reply) => {
    const me = ctx.requireUser(req);
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'editor');
    const { label } = versionBody.parse(req.body);
    const state = await collab.currentState(id);
    if (!state) throw new HttpError(404, 'Project not found');
    const [v] = await db
      .insert(projectVersions)
      .values({ projectId: id, state, label, kind: 'manual', createdBy: me.id })
      .returning({ id: projectVersions.id });
    collab.notifyChanges(id);
    return reply.status(201).send({ id: v!.id });
  });

  async function loadVersion(projectId: string, versionId: string) {
    if (!isUuid(versionId)) throw new HttpError(404, 'Version not found');
    const [v] = await db
      .select()
      .from(projectVersions)
      .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId)));
    if (!v) throw new HttpError(404, 'Version not found');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, v.state);
    return toSnapshot(doc);
  }

  app.get('/api/projects/:id/versions/:vid/snapshot', async (req) => {
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'viewer');
    return loadVersion(id, (req.params as { vid: string }).vid);
  });

  app.post('/api/projects/:id/versions/:vid/restore', async (req) => {
    const me = ctx.requireUser(req);
    const id = idParam(req.params);
    await ctx.requireRole(req, id, 'editor');
    const vid = (req.params as { vid: string }).vid;
    const snap = await loadVersion(id, vid);
    const [v] = await db
      .select({
        label: projectVersions.label,
        kind: projectVersions.kind,
        createdAt: projectVersions.createdAt,
      })
      .from(projectVersions)
      .where(eq(projectVersions.id, vid));
    const restoreLabel =
      v?.kind === 'manual' && v.label
        ? `“${v.label}”`
        : `from ${v?.createdAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? 'earlier'}`;
    const current = await collab.currentState(id);
    if (current)
      await db
        .insert(projectVersions)
        .values({
          projectId: id,
          state: current,
          label: 'Before restore',
          kind: 'restore',
          createdBy: me.id,
        });
    await collab.withDocument(id, (doc) => replaceContent(doc, snap, 'restore'), {
      userId: me.id,
      name: me.name,
      restoreLabel,
    });
    return { ok: true };
  });
}
