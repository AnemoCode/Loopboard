import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { addMessage, addThread, editMessage, getMessage, roots, setThreadResolved } from '@cld/model';
import { atLeast, commentBody, replyBody, resolveBody } from '@cld/shared';
import type { Ctx } from '../app.js';
import { isUuid } from '../access.js';
import { HttpError } from '../errors.js';

/**
 * Comment writes for every role that may comment. Viewers/commenters have read-only collab
 * connections, so the server applies their change to the shared document on their behalf —
 * this also guarantees commenters can only ever touch comments.
 */
export async function commentRoutes(app: FastifyInstance, ctx: Ctx) {
  const { collab } = ctx;
  const projectId = (p: unknown) => {
    const id = (p as { id: string }).id;
    if (!isUuid(id)) throw new HttpError(404, 'Project not found');
    return id;
  };

  app.post('/api/projects/:id/comments', async (req, reply) => {
    const me = ctx.requireUser(req);
    const id = projectId(req.params);
    await ctx.requireRole(req, id, 'commenter');
    const body = commentBody.parse(req.body);
    let threadId = '';
    await collab.withDocument(id, (doc) => {
      if (!roots(doc).diagrams.has(body.diagramId)) throw new HttpError(404, 'Diagram not found');
      threadId = addThread(doc, {
        diagramId: body.diagramId,
        ...(body.elementId ? { elementId: body.elementId } : {}),
        x: body.x,
        y: body.y,
        createdBy: me.id,
        createdAt: Date.now(),
        body: body.body,
        authorName: me.name,
      });
    });
    return reply.status(201).send({ id: threadId });
  });

  app.post('/api/projects/:id/comments/:threadId/messages', async (req, reply) => {
    const me = ctx.requireUser(req);
    const id = projectId(req.params);
    await ctx.requireRole(req, id, 'commenter');
    const { body } = replyBody.parse(req.body);
    const { threadId } = req.params as { threadId: string };
    let messageId: string | null = null;
    await collab.withDocument(id, (doc) => {
      messageId = addMessage(doc, threadId, { authorId: me.id, authorName: me.name, body, createdAt: Date.now() });
    });
    if (!messageId) throw new HttpError(404, 'Comment not found');
    return reply.status(201).send({ id: messageId });
  });

  app.patch('/api/projects/:id/comments/:threadId', async (req) => {
    const id = projectId(req.params);
    await ctx.requireRole(req, id, 'commenter');
    const { resolved } = resolveBody.parse(req.body);
    const { threadId } = req.params as { threadId: string };
    await collab.withDocument(id, (doc) => setThreadResolved(doc, threadId, resolved));
    return { ok: true };
  });

  const authorize = (doc: Y.Doc, threadId: string, messageId: string, userId: string, canModerate: boolean) => {
    const msg = getMessage(doc, threadId, messageId);
    if (!msg) throw new HttpError(404, 'Comment not found');
    if (msg.authorId !== userId && !canModerate) throw new HttpError(403, 'You can only change your own comments');
  };

  app.patch('/api/projects/:id/comments/:threadId/messages/:messageId', async (req) => {
    const me = ctx.requireUser(req);
    const id = projectId(req.params);
    await ctx.requireRole(req, id, 'commenter');
    const { body } = replyBody.parse(req.body);
    const { threadId, messageId } = req.params as { threadId: string; messageId: string };
    await collab.withDocument(id, (doc) => {
      authorize(doc, threadId, messageId, me.id, false);
      editMessage(doc, threadId, messageId, body);
    });
    return { ok: true };
  });

  app.delete('/api/projects/:id/comments/:threadId/messages/:messageId', async (req) => {
    const me = ctx.requireUser(req);
    const id = projectId(req.params);
    const role = await ctx.requireRole(req, id, 'commenter');
    const { threadId, messageId } = req.params as { threadId: string; messageId: string };
    await collab.withDocument(id, (doc) => {
      authorize(doc, threadId, messageId, me.id, atLeast(role, 'editor'));
      editMessage(doc, threadId, messageId, null);
    });
    return { ok: true };
  });
}
