import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import type { AppConfig, Me, Role } from '@cld/shared';
import { atLeast } from '@cld/shared';
import { createAuth, type Auth } from './auth.js';
import { createCollab, type Collab } from './collab.js';
import type { Db } from './db/index.js';
import type { Env } from './env.js';
import { getRole } from './access.js';
import { HttpError } from './errors.js';
import { projectRoutes } from './routes/projects.js';
import { sharingRoutes } from './routes/sharing.js';
import { commentRoutes } from './routes/comments.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: Me | null;
  }
}

export interface Ctx {
  env: Env;
  db: Db;
  auth: Auth;
  collab: Collab;
  /** Throws 401/403/404 unless the current user has at least `min` on the project. */
  requireRole: (req: FastifyRequest, projectId: string, min: Role) => Promise<Role>;
  requireUser: (req: FastifyRequest) => Me;
}

const headersOf = (req: FastifyRequest) => {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, String(v));
  }
  return h;
};

export async function buildApp(env: Env, db: Db) {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: true,
  });
  const auth = createAuth(env, db);
  const collab = createCollab(db, auth, app.log);
  const publicOrigin = new URL(env.PUBLIC_URL).origin;

  if (!env.DISABLE_RATE_LIMIT) await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).type('application/problem+json').send(err.problem());
    if (err.name === 'ZodError') {
      return reply.status(400).type('application/problem+json').send({ title: 'Invalid request', status: 400, detail: err.message });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).type('application/problem+json').send({ title: status >= 500 ? 'Something went wrong' : err.message, status });
  });

  // CSRF defence in depth (cookies are SameSite=Lax): mutating API calls must come from our origin.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== publicOrigin) throw new HttpError(403, 'Cross-origin request blocked');
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    const session = await auth.api.getSession({ headers: headersOf(req) });
    if (session) req.user = { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null };
  });

  const requireUser = (req: FastifyRequest): Me => {
    if (!req.user) throw new HttpError(401, 'Please sign in');
    return req.user;
  };
  const requireRole = async (req: FastifyRequest, projectId: string, min: Role): Promise<Role> => {
    const user = requireUser(req);
    const role = await getRole(db, projectId, user.id);
    if (!role) throw new HttpError(404, 'Project not found');
    if (!atLeast(role, min)) throw new HttpError(403, 'You do not have permission to do this');
    return role;
  };

  // ---- Better Auth
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      const url = new URL(req.url, env.PUBLIC_URL);
      const request = new Request(url, {
        method: req.method,
        headers: headersOf(req),
        body: req.method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      const res = await auth.handler(request);
      reply.status(res.status);
      res.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(res.body ? await res.text() : null);
    },
  });

  // ---- misc
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/ready', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });
  app.get('/api/config', async (): Promise<AppConfig> => ({
    socialProviders: [
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? (['google'] as const) : []),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? (['github'] as const) : []),
    ],
  }));
  app.get('/api/me', async (req) => requireUser(req));

  const ctx: Ctx = { env, db, auth, collab, requireRole, requireUser };
  await app.register(async (r) => projectRoutes(r, ctx));
  await app.register(async (r) => sharingRoutes(r, ctx));
  await app.register(async (r) => commentRoutes(r, ctx));

  // ---- real-time collaboration (Yjs over WebSocket; auth via the session cookie)
  app.get('/collab', { websocket: true }, (socket, req) => {
    const request = new Request(new URL(req.url, env.PUBLIC_URL), { headers: headersOf(req) });
    const conn = collab.hocuspocus.handleConnection(socket, request);
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
      conn.handleMessage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    });
    socket.on('close', (code: number, reason: Buffer) => conn.handleClose({ code, reason: reason.toString() } as CloseEvent));
    socket.on('pong', () => conn.touch());
  });

  app.addHook('onClose', async () => {
    collab.hocuspocus.closeConnections();
    collab.hocuspocus.flushPendingStores();
    // Give pending stores a moment to finish.
    await new Promise((r) => setTimeout(r, 200));
  });

  return { app, ctx };
}
