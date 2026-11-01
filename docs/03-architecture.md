# 03: Architecture

## System overview

```
                         ┌─────────────────────────────────────────────┐
  Browser (SPA)          │                 Caddy (TLS)                 │
 ┌──────────────────┐    │  /            → web   (static files)        │
 │ React UI         │◄──►│  /api/*       → api   (HTTP, Fastify)       │
 │ Editor engine    │    │  /collab      → collab (WebSocket, Hocuspocus)│
 │ Y.Doc + provider │    └───────┬───────────────┬───────────────┬─────┘
 │ IndexedDB cache  │            │               │               │
 └──────────────────┘     ┌──────▼─────┐  ┌──────▼──────┐ ┌──────▼──────┐
                          │    web     │  │    api      │ │   collab    │ ×N
                          │  (nginx/   │  │  Fastify    │ │ Hocuspocus  │
                          │   caddy    │  │  Better Auth│ │ auth hook   │
                          │   static)  │  │  exports    │ │ persistence │
                          └────────────┘  └──┬───┬───┬──┘ └──┬────┬─────┘
                                             │   │   │       │    │
                                   ┌─────────▼┐ ┌▼───▼───────▼┐ ┌─▼──────┐
                                   │  MinIO   │ │ PostgreSQL  │ │ Redis  │
                                   │ (S3)     │ │             │ │ pub/sub│
                                   └──────────┘ └─────────────┘ └────────┘
```

### Services

| Service | Responsibility | Scales |
|---------|----------------|--------|
| **web** | Serves the built SPA (immutable hashed assets) | Stateless, CDN-able |
| **api** | Auth, projects CRUD, membership/invites, version list, import/export jobs, thumbnails, collab tokens | Stateless, horizontal |
| **collab** | Yjs sync over WebSocket, awareness relay, auth per document, load/store snapshots, fan-out via Redis | Horizontal (Redis extension); sticky sessions optional |
| **postgres** | Source of truth | Vertical + backups |
| **redis** | Cross-instance Yjs/awareness pub/sub, rate limiting, short-lived caches | Single node is fine at first |
| **minio** | Thumbnails, uploaded `.mdl` originals, generated export files | n/a |

A **worker** (same image as `api`, different entrypoint) is added in a later phase to run thumbnails, server-side exports and scheduled snapshot compaction. It uses a Postgres-backed queue (`pg-boss`), so no extra broker is needed.

## Monorepo layout

```
.
├── apps/
│   ├── web/                 # React SPA
│   │   ├── src/
│   │   │   ├── app/         # routes (TanStack Router), layouts
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── dashboard/      # project list, create, thumbnails
│   │   │   │   ├── editor/         # editor shell: toolbar, panels, tabs
│   │   │   │   ├── collaboration/  # presence UI, cursors, follow mode
│   │   │   │   ├── comments/
│   │   │   │   ├── export/
│   │   │   │   └── settings/
│   │   │   ├── components/ui/      # shadcn components
│   │   │   ├── lib/                # api client, query client, hooks
│   │   │   └── styles/
│   │   └── Dockerfile
│   ├── api/                 # Fastify server (+ worker entrypoint)
│   │   ├── src/
│   │   │   ├── routes/      # projects, members, invites, versions, import, export
│   │   │   ├── auth/        # Better Auth config
│   │   │   ├── db/          # drizzle schema, migrations
│   │   │   ├── services/
│   │   │   ├── jobs/        # pg-boss jobs (worker)
│   │   │   └── server.ts / worker.ts
│   │   └── Dockerfile
│   └── collab/              # Hocuspocus server
│       ├── src/
│       │   ├── auth.ts      # verify collab JWT, set readOnly
│       │   ├── persistence.ts
│       │   ├── hooks/       # onChange → debounce snapshot, thumbnail trigger
│       │   └── server.ts
│       └── Dockerfile
├── packages/
│   ├── shared/              # zod schemas, types, constants
│   ├── model/               # Y.Doc schema, typed accessors, doc migrations
│   ├── geometry/            # arc math, clipping, hit-tests
│   ├── render/              # pure SVG renderer
│   ├── editor/              # framework-light editor engine (tools, selection, commands)
│   ├── mdl/                 # Vensim parser/writer + fixtures
│   ├── analysis/            # loop detection etc.
│   ├── ui-tokens/           # design tokens (colors, spacing, palettes)
│   └── config/              # tsconfig, eslint, prettier presets
├── e2e/                     # Playwright tests (multi-browser collaboration)
├── docker/
│   ├── caddy/Caddyfile
│   └── postgres/init.sql
├── compose.yaml             # production-like
├── compose.dev.yaml         # dev overrides (hot reload, exposed ports)
├── turbo.json
├── pnpm-workspace.yaml
└── docs/
```

## Data flow

### Opening a project

1. The SPA loads and `GET /api/me` restores the session from its cookie.
2. Editor route `/p/:projectId/d/:diagramId`.
3. `POST /api/projects/:id/collab-token` → the API checks membership and returns a JWT (≤ 5 min lifetime) containing `{ sub, projectId, role }`.
4. The client creates a `HocuspocusProvider({ url: '/collab', name: 'project:<id>', token })`. A `y-indexeddb` provider loads the locally cached state first, so the editor shows something immediately.
5. collab `onAuthenticate` verifies the JWT. A role of `viewer` or `commenter` → `connection.readOnly = true`. (Commenters write comments through the API, see 05.)
6. collab `onLoadDocument` loads the latest snapshot plus any pending updates from Postgres and applies doc-schema migrations (`@cld/model/migrate`).
7. Sync step 1/2 runs, then awareness starts.

### Editing

- Each user action becomes a **command** in `@cld/editor` (e.g. `MoveElements`, `CreateLink`, `SetStyle`). The command opens a `doc.transact(fn, LOCAL_ORIGIN)` and mutates `Y.Map`s.
- Yjs emits an update, the provider sends it to collab, and collab broadcasts it to the other clients and to Redis for other instances.
- Remote clients' Yjs observers map changed keys to a **render store** (Zustand, keyed by element id), and only the affected React components re-render.
- Ephemeral state (cursor, selection, in-progress drag offsets, text-editing caret) goes through **awareness** only and never touches the document.

### Persistence

- collab buffers updates. `onStoreDocument` (debounced 2 s, max wait 10 s) writes `Y.encodeStateAsUpdate(doc)` to `project_documents.state` (bytea) and bumps `updated_at`.
- Every N minutes of activity, or on demand ("Save version"), an immutable row goes into `project_versions` (full snapshot + author + label).
- On a change, a thumbnail job is queued (debounced per project, 60 s). It renders the first diagram via `@cld/render` → resvg → PNG → MinIO.

### Import / export

See [08](08-import-export.md). Client-side by default. The API offers the same operations for integrations and for files too big to handle comfortably in the browser.

## Cross-cutting concerns

- **Config:** env vars validated with Zod at boot, in each app's `src/env.ts`.
- **Logging:** pino as JSON with a request id. collab logs connection lifecycle and document ids, never content.
- **Errors:** typed error codes in `@cld/shared/errors`. The API returns RFC 9457 `application/problem+json`.
- **Feature flags:** a simple `FEATURES` env plus a per-project flag map in project meta.
- **i18n:** strings routed through `i18next` from day one. English first, German second.
