import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { eq, sql } from 'drizzle-orm';
import { parseMdl, writeMdl } from '@cld/mdl';
import {
  addElement,
  addVariableNode,
  moveElements,
  renameVariable,
  roots,
  setStyle,
  toSnapshot,
  updateElement,
} from '@cld/model';
import { docName } from '@cld/shared';
import { buildApp } from '../src/app.js';
import { createDb, runMigrations } from '../src/db/index.js';
import { loadEnv } from '../src/env.js';
import { cleanupGuests } from '../src/guests.js';
import { user as userTable } from '../src/db/schema.js';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://loopwise:loopwise@localhost:5433/loopwise_test';
const ORIGIN = 'http://localhost:5173';
const env = loadEnv({
  DATABASE_URL,
  NODE_ENV: 'test',
  PUBLIC_URL: ORIGIN,
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
});
const { db, client } = createDb(DATABASE_URL);
let base = '';
let close: () => Promise<void>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
    await wait(25);
  }
}

class User {
  cookie = '';
  constructor(
    readonly name: string,
    readonly email: string,
  ) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie: this.cookie,
        origin: ORIGIN,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    const json: unknown = (() => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    })();
    return { status: res.status, json: json as any, text, headers: res.headers };
  }
  async signUp() {
    const r = await this.req('POST', '/api/auth/sign-up/email', {
      name: this.name,
      email: this.email,
      password: 'correct-horse-battery',
    });
    expect(r.status).toBe(200);
    return this;
  }
  connect(projectId: string) {
    const cookie = this.cookie;
    class CookieWS extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie } });
      }
    }
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${base.replace('http', 'ws')}/collab`,
      WebSocketPolyfill: CookieWS,
    });
    const state = {
      synced: false,
      scope: '' as string,
      failed: '' as string,
      closed: 0,
      stateless: 0,
    };
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: docName(projectId),
      document: doc,
      token: 'session',
      onSynced: () => (state.synced = true),
      onAuthenticated: ({ scope }) => (state.scope = scope),
      onAuthenticationFailed: ({ reason }) => (state.failed = reason),
      onClose: () => state.closed++,
      onStateless: () => state.stateless++,
    });
    // A provider sharing an explicit socket must be attached.
    provider.attach();
    return {
      doc,
      provider,
      state,
      destroy: () => {
        provider.destroy();
        socket.destroy();
      },
    };
  }
}

beforeAll(async () => {
  await db.execute(
    sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`,
  );
  await runMigrations(db);
  const { app } = await buildApp(env, db);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  close = async () => {
    await app.close();
    await client.end();
  };
});

afterAll(async () => close());

const alice = new User('Alice', 'alice@example.com');
const bob = new User('Bob', 'bob@example.com');
const carol = new User('Carol', 'carol@example.com');
let projectId = '';

describe('auth', () => {
  it('signs up and reports the session', async () => {
    await alice.signUp();
    await bob.signUp();
    const me = await alice.req('GET', '/api/me');
    expect(me.json).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect((await new User('x', 'y').req('GET', '/api/me')).status).toBe(401);
  });

  it('blocks cross-origin mutations', async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: {
        cookie: alice.cookie,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('projects', () => {
  it('creates, lists, renames and renders a thumbnail', async () => {
    const created = await alice.req('POST', '/api/projects', { name: 'Coffee' });
    expect(created.status).toBe(201);
    projectId = created.json.id;
    const list = await alice.req('GET', '/api/projects');
    expect(list.json).toMatchObject([
      { id: projectId, name: 'Coffee', role: 'owner', ownerName: 'Alice', memberCount: 1 },
    ]);
    expect(
      (await alice.req('PATCH', `/api/projects/${projectId}`, { name: 'Coffee CLD' })).status,
    ).toBe(200);
    expect((await bob.req('GET', `/api/projects/${projectId}`)).status).toBe(404);
    const thumb = await alice.req('GET', `/api/projects/${projectId}/thumbnail.svg`);
    expect(thumb.headers.get('content-type')).toContain('image/svg+xml');
    expect(thumb.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('rejects invalid snapshots on import', async () => {
    const r = await alice.req('POST', '/api/projects', {
      name: 'Bad',
      snapshot: { meta: {}, diagrams: 5 },
    });
    expect(r.status).toBe(400);
  });

  it('imports a Vensim model and exports it unchanged', async () => {
    const text = readFileSync(
      new URL('../../../packages/mdl/test/fixtures/servitization.mdl', import.meta.url),
      'utf8',
    );
    const r = await alice.req('POST', '/api/projects', {
      name: 'Servitization',
      snapshot: parseMdl(text).snapshot,
    });
    expect(r.status).toBe(201);
    const c = alice.connect(r.json.id);
    await until(() => c.state.synced);
    expect(writeMdl(toSnapshot(c.doc)).text).toBe(text);
    const versions = await alice.req('GET', `/api/projects/${r.json.id}/versions`);
    expect(versions.json[0]).toMatchObject({ kind: 'import', label: 'Imported' });
    c.destroy();
  });
});

describe('real-time collaboration', () => {
  it('syncs edits and presence between editors and enforces read-only roles', async () => {
    // Bob joins as editor via email invite (existing account), Carol via a viewer link after signing up.
    expect(
      (
        await alice.req('POST', `/api/projects/${projectId}/members`, {
          email: 'bob@example.com',
          role: 'editor',
        })
      ).json,
    ).toEqual({ status: 'added' });
    const link = await alice.req('POST', `/api/projects/${projectId}/links`, { role: 'viewer' });
    await carol.signUp();
    const preview = await carol.req('GET', `/api/invites/${link.json.token}`);
    expect(preview.json).toMatchObject({
      projectName: 'Coffee CLD',
      role: 'viewer',
      invitedBy: 'Alice',
      viewer: { alreadyMember: false, isGuest: false },
    });
    expect((await carol.req('POST', `/api/invites/${link.json.token}/accept`)).json).toEqual({
      projectId,
    });

    const a = alice.connect(projectId);
    const b = bob.connect(projectId);
    const c = carol.connect(projectId);
    await until(() => a.state.synced && b.state.synced && c.state.synced);
    expect(a.state.scope).toBe('read-write');
    expect(c.state.scope).toBe('readonly');

    const diagramId = [...roots(a.doc).diagrams.keys()][0]!;
    const layerId = [
      ...(roots(a.doc).diagrams.get(diagramId)!.get('layers') as Y.Map<unknown>).keys(),
    ][0]!;
    addVariableNode(a.doc, diagramId, { name: 'Births', x: 10, y: 20, layerId });
    await until(() => Object.keys(toSnapshot(b.doc).variables).length === 1);
    await until(() => Object.keys(toSnapshot(c.doc).variables).length === 1);

    // Presence
    a.provider.setAwarenessField('user', { name: 'Alice' });
    await until(() =>
      [...b.provider.awareness!.getStates().values()].some((s) => s.user?.name === 'Alice'),
    );

    // A viewer's local edits are not accepted by the server.
    addVariableNode(c.doc, diagramId, { name: 'Sneaky', x: 0, y: 0, layerId });
    await wait(400);
    expect(Object.values(toSnapshot(a.doc).variables).map((v) => v.name)).toEqual(['Births']);

    // Unknown project / outsider is refused.
    const outsider = new User('Eve', 'eve@example.com');
    await outsider.signUp();
    const e = outsider.connect(projectId);
    await until(() => e.state.failed !== '');
    e.destroy();

    // Removing Bob disconnects him.
    const closedBefore = b.state.closed;
    expect(
      (
        await alice.req(
          'DELETE',
          `/api/projects/${projectId}/members/${(await bob.req('GET', '/api/me')).json.id}`,
        )
      ).status,
    ).toBe(200);
    await until(() => b.state.closed > closedBefore);
    expect((await bob.req('GET', `/api/projects/${projectId}`)).status).toBe(404);

    // Persistence: after everyone leaves, a fresh connection gets the stored state.
    a.destroy();
    b.destroy();
    c.destroy();
    await wait(300);
    const again = alice.connect(projectId);
    await until(() => again.state.synced);
    expect(Object.values(toSnapshot(again.doc).variables).map((v) => v.name)).toEqual(['Births']);
    again.destroy();
  });

  it('lets commenters comment through the API but not edit', async () => {
    await alice.req(
      'PATCH',
      `/api/projects/${projectId}/members/${(await carol.req('GET', '/api/me')).json.id}`,
      { role: 'commenter' },
    );
    const a = alice.connect(projectId);
    await until(() => a.state.synced);
    const diagramId = [...roots(a.doc).diagrams.keys()][0]!;
    const res = await carol.req('POST', `/api/projects/${projectId}/comments`, {
      diagramId,
      x: 5,
      y: 5,
      body: 'Is this a delay?',
    });
    expect(res.status).toBe(201);
    await until(() => Object.keys(toSnapshot(a.doc).comments).length === 1);
    const thread = Object.values(toSnapshot(a.doc).comments)[0]!;
    expect(thread.messages[0]).toMatchObject({ body: 'Is this a delay?', authorName: 'Carol' });
    const reply = await alice.req(
      'POST',
      `/api/projects/${projectId}/comments/${thread.id}/messages`,
      { body: 'Yes' },
    );
    // Carol can't edit Alice's message, but can resolve.
    expect(
      (
        await carol.req(
          'PATCH',
          `/api/projects/${projectId}/comments/${thread.id}/messages/${reply.json.id}`,
          { body: 'No' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await carol.req('PATCH', `/api/projects/${projectId}/comments/${thread.id}`, {
          resolved: true,
        })
      ).status,
    ).toBe(200);
    await until(() => Object.values(toSnapshot(a.doc).comments)[0]!.resolved);
    expect(
      (await carol.req('POST', `/api/projects/${projectId}/versions`, { label: 'x' })).status,
    ).toBe(403);
    a.destroy();
  });
});

describe('versions, duplicate, delete', () => {
  it('saves and restores versions', async () => {
    const a = alice.connect(projectId);
    await until(() => a.state.synced);
    expect(
      (await alice.req('POST', `/api/projects/${projectId}/versions`, { label: 'Before growth' }))
        .status,
    ).toBe(201);
    const diagramId = [...roots(a.doc).diagrams.keys()][0]!;
    const layerId = [
      ...(roots(a.doc).diagrams.get(diagramId)!.get('layers') as Y.Map<unknown>).keys(),
    ][0]!;
    addVariableNode(a.doc, diagramId, { name: 'Deaths', x: 10, y: 20, layerId });
    await wait(200);
    const list = await alice.req('GET', `/api/projects/${projectId}/versions`);
    const v = list.json.find((x: { label: string }) => x.label === 'Before growth');
    const snap = await alice.req('GET', `/api/projects/${projectId}/versions/${v.id}/snapshot`);
    expect(Object.values(snap.json.variables).map((x: any) => x.name)).toEqual(['Births']);
    expect(
      (await alice.req('POST', `/api/projects/${projectId}/versions/${v.id}/restore`)).status,
    ).toBe(200);
    await until(
      () =>
        Object.values(toSnapshot(a.doc).variables)
          .map((x) => x.name)
          .join() === 'Births',
    );
    const after = await alice.req('GET', `/api/projects/${projectId}/versions`);
    expect(after.json[0]).toMatchObject({ kind: 'restore', label: 'Before restore' });
    a.destroy();
  });

  it('duplicates and deletes', async () => {
    const dup = await carol.req('POST', `/api/projects/${projectId}/duplicate`);
    expect(dup.status).toBe(201);
    expect((await carol.req('GET', `/api/projects/${dup.json.id}`)).json).toMatchObject({
      name: 'Coffee CLD (copy)',
      role: 'owner',
    });
    expect((await carol.req('DELETE', `/api/projects/${projectId}`)).status).toBe(403);
    expect((await alice.req('DELETE', `/api/projects/${projectId}`)).status).toBe(200);
    expect((await alice.req('GET', `/api/projects/${projectId}`)).status).toBe(404);
  });

  it('turns pending email invites into memberships on sign-up', async () => {
    const p = await alice.req('POST', '/api/projects', { name: 'Shared later' });
    expect(
      (
        await alice.req('POST', `/api/projects/${p.json.id}/members`, {
          email: 'dave@example.com',
          role: 'commenter',
        })
      ).json,
    ).toEqual({ status: 'invited' });
    const members = await alice.req('GET', `/api/projects/${p.json.id}/members`);
    expect(members.json.invites).toMatchObject([{ email: 'dave@example.com', role: 'commenter' }]);
    const dave = await new User('Dave', 'dave@example.com').signUp();
    expect((await dave.req('GET', `/api/projects/${p.json.id}`)).json.role).toBe('commenter');
  });
});

describe('guest access via share links', () => {
  const owner = new User('Gina', 'gina@example.com');
  let pid = '';
  let link: { id: string; token: string; allowGuests: boolean };
  const guest = new User('Jonas', '');

  it('lets a visitor join with just a name and collaborate', async () => {
    await owner.signUp();
    pid = (await owner.req('POST', '/api/projects', { name: 'Workshop' })).json.id;
    link = (await owner.req('POST', `/api/projects/${pid}/links`, { role: 'editor' })).json;
    expect(link.allowGuests).toBe(true);

    const preview = await guest.req('GET', `/api/invites/${link.token}`);
    expect(preview.json).toMatchObject({
      projectName: 'Workshop',
      role: 'editor',
      invitedBy: 'Gina',
      allowGuests: true,
      viewer: null,
    });

    expect(
      (await guest.req('POST', `/api/invites/${link.token}/guest`, { name: '  ' })).status,
    ).toBe(400);
    const joined = await guest.req('POST', `/api/invites/${link.token}/guest`, { name: 'Jonas' });
    expect(joined.json).toEqual({ projectId: pid });
    expect((await guest.req('GET', '/api/me')).json).toMatchObject({
      name: 'Jonas',
      email: '',
      isGuest: true,
    });

    const g = guest.connect(pid);
    const o = owner.connect(pid);
    await until(() => g.state.synced && o.state.synced);
    expect(g.state.scope).toBe('read-write');
    const diagramId = [...roots(g.doc).diagrams.keys()][0]!;
    const layerId = [
      ...(roots(g.doc).diagrams.get(diagramId)!.get('layers') as Y.Map<unknown>).keys(),
    ][0]!;
    addVariableNode(g.doc, diagramId, { name: 'Guest idea', x: 0, y: 0, layerId });
    await until(() =>
      Object.values(toSnapshot(o.doc).variables).some((v) => v.name === 'Guest idea'),
    );
    g.destroy();
    o.destroy();
  });

  it('keeps guests out of account-only actions and hides emails', async () => {
    expect((await guest.req('POST', '/api/projects', { name: 'Mine' })).status).toBe(403);
    expect((await guest.req('POST', `/api/projects/${pid}/duplicate`)).status).toBe(403);
    expect((await guest.req('PATCH', `/api/projects/${pid}`, { name: 'x' })).status).toBe(403);
    expect((await guest.req('POST', `/api/projects/${pid}/links`, { role: 'editor' })).status).toBe(
      403,
    );
    expect(
      (await guest.req('POST', `/api/projects/${pid}/members`, { email: 'a@b.de', role: 'editor' }))
        .status,
    ).toBe(403);
    const asGuest = await guest.req('GET', `/api/projects/${pid}/members`);
    expect(asGuest.json.members.every((m: { email: string | null }) => m.email === null)).toBe(
      true,
    );
    const asOwner = await owner.req('GET', `/api/projects/${pid}/members`);
    expect(asOwner.json.members).toMatchObject([
      { name: 'Gina', email: 'gina@example.com', isGuest: false },
      { name: 'Jonas', email: null, isGuest: true },
    ]);
    // Guests may rename themselves and leave.
    expect((await guest.req('PATCH', '/api/me', { name: 'Jonas W.' })).json.name).toBe('Jonas W.');
  });

  it('reuses the guest identity for a second link and respects guest switches', async () => {
    const me = (await guest.req('GET', '/api/me')).json.id;
    const p2 = (await owner.req('POST', '/api/projects', { name: 'Second' })).json.id;
    const closed = (
      await owner.req('POST', `/api/projects/${p2}/links`, { role: 'viewer', allowGuests: false })
    ).json;
    const preview = await guest.req('GET', `/api/invites/${closed.token}`);
    expect(preview.json).toMatchObject({
      allowGuests: false,
      viewer: { isGuest: true, alreadyMember: false },
    });
    expect(
      (await guest.req('POST', `/api/invites/${closed.token}/guest`, { name: 'Jonas' })).status,
    ).toBe(403);
    expect(
      (await new User('x', '').req('POST', `/api/invites/${closed.token}/guest`, { name: 'Anon' }))
        .status,
    ).toBe(403);
    await owner.req('PATCH', `/api/projects/${p2}/links/${closed.id}`, { allowGuests: true });
    expect(
      (await guest.req('POST', `/api/invites/${closed.token}/guest`, { name: 'Jonas' })).json,
    ).toEqual({ projectId: p2 });
    expect((await guest.req('GET', '/api/me')).json.id).toBe(me);
    expect(
      (await guest.req('GET', '/api/projects')).json.map((p: { name: string }) => p.name).sort(),
    ).toEqual(['Second', 'Workshop']);
  });

  it('removes the guests of a revoked link', async () => {
    const extra = new User('Temp', '');
    await extra.req('POST', `/api/invites/${link.token}/guest`, { name: 'Temp' });
    const links = (await owner.req('GET', `/api/projects/${pid}/links`)).json;
    expect(links[0]).toMatchObject({ guestCount: 2 });
    const c = extra.connect(pid);
    await until(() => c.state.synced);
    const closedBefore = c.state.closed;
    // Keep Jonas: owner promotes him to a regular member of this project by removing the link association later.
    const res = await owner.req(
      'DELETE',
      `/api/projects/${pid}/links/${link.id}?removeGuests=true`,
    );
    expect(res.json).toEqual({ ok: true, removedGuests: 2 });
    await until(() => c.state.closed > closedBefore);
    expect((await extra.req('GET', `/api/projects/${pid}`)).status).toBe(404);
    expect((await extra.req('GET', `/api/invites/${link.token}`)).status).toBe(404);
    c.destroy();
  });

  it('moves everything to the account when a guest signs up', async () => {
    const newLink = (await owner.req('POST', `/api/projects/${pid}/links`, { role: 'commenter' }))
      .json;
    const visitor = new User('Vivi', 'vivi@example.com');
    await visitor.req('POST', `/api/invites/${newLink.token}/guest`, { name: 'Vivi' });
    const guestId = (await visitor.req('GET', '/api/me')).json.id;
    const o = owner.connect(pid);
    await until(() => o.state.synced);
    const diagramId = [...roots(o.doc).diagrams.keys()][0]!;
    await visitor.req('POST', `/api/projects/${pid}/comments`, {
      diagramId,
      x: 1,
      y: 1,
      body: 'Guest comment',
    });
    await until(() => Object.keys(toSnapshot(o.doc).comments).length === 1);

    await visitor.signUp();
    const me = (await visitor.req('GET', '/api/me')).json;
    expect(me).toMatchObject({ isGuest: false, email: 'vivi@example.com' });
    expect(me.id).not.toBe(guestId);
    expect((await visitor.req('GET', `/api/projects/${pid}`)).json.role).toBe('commenter');
    await until(
      () => Object.values(toSnapshot(o.doc).comments)[0]!.messages[0]!.authorId === me.id,
    );
    expect(Object.values(toSnapshot(o.doc).comments)[0]!.createdBy).toBe(me.id);
    expect(await db.select().from(userTable).where(eq(userTable.id, guestId))).toHaveLength(0);
    // Their changelog entries now belong to the account.
    const log = (await owner.req('GET', `/api/projects/${pid}/changes`)).json.changes;
    expect(log.find((c: any) => c.summary.startsWith('commented'))).toMatchObject({ userId: me.id, userName: 'Vivi' });
    o.destroy();
  });

  it('merges into an existing account on sign-in, keeping the higher role', async () => {
    const editorLink = (await owner.req('POST', `/api/projects/${pid}/links`, { role: 'editor' }))
      .json;
    const carolGuest = new User('Carol', 'carol@example.com'); // Carol already has an account (commenter elsewhere)
    await carolGuest.req('POST', `/api/invites/${editorLink.token}/guest`, { name: 'Carol' });
    const res = await carolGuest.req('POST', '/api/auth/sign-in/email', {
      email: 'carol@example.com',
      password: 'correct-horse-battery',
    });
    expect(res.status).toBe(200);
    expect((await carolGuest.req('GET', '/api/me')).json.isGuest).toBe(false);
    expect((await carolGuest.req('GET', `/api/projects/${pid}`)).json.role).toBe('editor');
  });

  it('cleans up guests without projects', async () => {
    const lonely = new User('Lonely', '');
    const l = (await owner.req('POST', `/api/projects/${pid}/links`, { role: 'viewer' })).json;
    await lonely.req('POST', `/api/invites/${l.token}/guest`, { name: 'Lonely' });
    const id = (await lonely.req('GET', '/api/me')).json.id;
    await lonely.req('DELETE', `/api/projects/${pid}/members/${id}`);
    await db
      .update(userTable)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) })
      .where(eq(userTable.id, id));
    expect(await cleanupGuests(db)).toBeGreaterThanOrEqual(1);
    expect((await lonely.req('GET', '/api/me')).status).toBe(401);
  });
});

describe('changelog', () => {
  const lead = new User('Lena', 'lena@example.com');
  const mate = new User('Max', 'max@example.com');

  it('records who changed what, groups moves and notifies clients live', async () => {
    await lead.signUp();
    await mate.signUp();
    const pid = (await lead.req('POST', '/api/projects', { name: 'Logged' })).json.id;
    await lead.req('POST', `/api/projects/${pid}/members`, {
      email: 'max@example.com',
      role: 'editor',
    });
    const l = lead.connect(pid);
    const m = mate.connect(pid);
    await until(() => l.state.synced && m.state.synced);
    const d = [...roots(m.doc).diagrams.keys()][0]!;
    const layer = [...(roots(m.doc).diagrams.get(d)!.get('layers') as Y.Map<unknown>).keys()][0]!;
    const LOCAL = { local: true };

    const a = addVariableNode(m.doc, d, { name: 'Births', x: 0, y: 0, layerId: layer }, LOCAL);
    const b = addVariableNode(
      m.doc,
      d,
      { name: 'Population', x: 300, y: 0, layerId: layer },
      LOCAL,
    );
    const link = addElement(
      m.doc,
      d,
      { type: 'link', layerId: layer, from: a, to: b, control: null, polarity: null },
      LOCAL,
    );
    updateElement(m.doc, d, link, { polarity: '+' }, LOCAL);
    // Several moves in a row become one entry.
    moveElements(m.doc, d, [{ id: a, dx: 10, dy: 0 }], LOCAL);
    moveElements(m.doc, d, [{ id: b, dx: 0, dy: 20 }], LOCAL);
    moveElements(m.doc, d, [{ id: a, dx: 5, dy: 5 }], LOCAL);
    const vid = (toSnapshot(m.doc).diagrams[d]!.elements[a] as { variableId: string }).variableId;
    renameVariable(m.doc, vid, 'Birth rate', LOCAL);
    await until(() => !!toSnapshot(l.doc).diagrams[d]!.elements[b]);
    setStyle(l.doc, d, [b], { textColor: '#2563eb' }, LOCAL);

    await until(() => l.state.stateless > 0);
    const expected = [
      'Lena changed text color of “Population”',
      'Max renamed “Births” to “Birth rate”',
      'Max rearranged 2 elements',
      'Max set polarity of “Births → Population” to +',
      'Max added link “Births → Population”',
      'Max added variable “Population”',
      'Max added variable “Births”',
    ];
    const read = async () =>
      (await lead.req('GET', `/api/projects/${pid}/changes`)).json.changes.map(
        (c: any) => `${c.userName} ${c.summary}`,
      );
    const start = Date.now();
    while (JSON.stringify(await read()) !== JSON.stringify(expected) && Date.now() - start < 4000)
      await wait(50);
    expect(await read()).toEqual(expected);
    const first = (await lead.req('GET', `/api/projects/${pid}/changes`)).json.changes;
    expect(first[2]).toMatchObject({ kind: 'layout', diagramId: d });
    expect(first[2].elementIds.sort()).toEqual([a, b].sort());

    // Comments through the API and restores are attributed and logged.
    await mate.req('POST', `/api/projects/${pid}/comments`, {
      diagramId: d,
      elementId: a,
      x: 0,
      y: 0,
      body: 'Delay?',
    });
    await lead.req('POST', `/api/projects/${pid}/versions`, { label: 'Clean' });
    const versions = (await lead.req('GET', `/api/projects/${pid}/versions`)).json;
    await lead.req(
      'POST',
      `/api/projects/${pid}/versions/${versions.find((v: any) => v.label === 'Clean').id}/restore`,
    );
    const s2 = Date.now();
    let latest: string[] = [];
    while (Date.now() - s2 < 4000) {
      latest = (await read()).slice(0, 2);
      if (latest[0]?.startsWith('Lena restored')) break;
      await wait(50);
    }
    expect(latest).toEqual([
      'Lena restored the version “Clean”',
      'Max commented on “Birth rate”: “Delay?”',
    ]);

    // Paging
    const p1 = (await lead.req('GET', `/api/projects/${pid}/changes?limit=3`)).json;
    expect(p1.changes).toHaveLength(3);
    const p2 = (
      await lead.req('GET', `/api/projects/${pid}/changes?limit=3&before=${p1.nextCursor}`)
    ).json;
    expect(p2.changes[0].id).toBeLessThan(p1.changes[2].id);
    l.destroy();
    m.destroy();
  });
});
