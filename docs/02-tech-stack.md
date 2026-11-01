# 02: Tech Stack

The stack is TypeScript end-to-end, so types, Zod schemas, the Yjs document schema, the MDL codec and the SVG renderer can all be **shared** between browser, API and collab server. Pin exact versions when scaffolding. The ones below are the intended major lines.

## Overview

| Layer | Choice | Version line |
|-------|--------|--------------|
| Language | TypeScript (strict) | 5.x |
| Runtime | Node.js LTS | 24.x |
| Package manager / monorepo | pnpm workspaces + Turborepo | pnpm 10, turbo 2 |
| Frontend framework | React + Vite | React 19, Vite 7 |
| Routing / server state | TanStack Router + TanStack Query | v1 / v5 |
| Local UI state | Zustand | 5 |
| Canvas | Custom SVG engine (`@cld/editor` + `@cld/render`) | n/a |
| Pan/zoom math | `d3-zoom`-style transform (own impl, ~200 LOC) | n/a |
| UI components | shadcn/ui (Radix primitives) + Tailwind CSS | Tailwind 4 |
| Icons | lucide-react | n/a |
| Color picker | react-colorful | n/a |
| CRDT | Yjs | 13.x |
| Collab server | Hocuspocus (server + provider) | v3 |
| HTTP API | Fastify + Zod (`fastify-type-provider-zod`) | Fastify 5 |
| ORM / migrations | Drizzle ORM + drizzle-kit | n/a |
| Auth | Better Auth (Postgres adapter) | 1.x |
| Database | PostgreSQL | 18 |
| Cache / pub-sub | Redis (or Valkey) | 7/8 |
| Object storage | MinIO (dev/self-host), S3-compatible in prod | n/a |
| PDF export | jsPDF + svg2pdf.js (client), same libs in Node for server | n/a |
| PNG export (server) | @resvg/resvg-js | n/a |
| Graph algorithms | own Johnson's cycle detection; `elkjs` for auto-layout | n/a |
| Testing | Vitest, Testing Library, Playwright | n/a |
| Lint / format | ESLint (flat config) + typescript-eslint, Prettier | n/a |
| Reverse proxy | Caddy (auto-TLS, WebSocket) | 2 |
| Containers | Docker, multi-stage builds, Docker Compose | Compose v2 |
| CI | GitHub Actions | n/a |
| Observability | pino logs, OpenTelemetry → (Grafana/Tempo or any OTLP), Sentry for FE errors | n/a |

## Key decisions and rationale

### D1: Yjs + Hocuspocus for real-time

**Why:** Yjs is the most mature CRDT for JavaScript. It handles concurrent edits without a central lock, merges offline edits, and its *awareness* protocol already covers ephemeral presence (cursors, selections). Hocuspocus is an MIT-licensed, production-grade Yjs WebSocket server with hooks for auth (`onAuthenticate`), persistence (`@hocuspocus/extension-database`), horizontal scaling (`@hocuspocus/extension-redis`), throttling and webhooks. Building our own would mean re-solving many hard problems.

**Rejected:**
- *Liveblocks / PartyKit / hosted services:* vendor lock-in, recurring cost, and harder to run with Docker on our own servers.
- *Automerge:* good, but its JS ecosystem and presence tooling are less mature than Yjs + Hocuspocus.
- *Socket.IO with server-authoritative operations (OT-style):* we'd have to hand-write conflict resolution, offline handling and undo.

### D2: Custom SVG canvas instead of React Flow / tldraw / Konva

**Why:** CLDs have needs that don't fit generic node-graph libraries:
- Vensim arrows are **circular arcs defined by one control point**. Matching that geometry exactly is what makes MDL round-trips lossless (see 07).
- Loop markers, polarity signs placed beside arrowheads, and delay marks are domain-specific.
- **Exports must match the canvas exactly.** A pure function `renderDiagramToSvg(doc, diagramId, opts)` in `@cld/render` can be used by the editor (as React components that share the same geometry code), by client exports, and headless on the server. React Flow renders nodes as HTML `<div>`s, which makes vector PDF export lossy (foreignObject/rasterisation).
- CLDs are small (tens to a few hundred elements), so SVG performs well enough. We don't need a WebGL/Canvas2D renderer.

**Rejected:**
- *React Flow (xyflow):* fastest to start with, but HTML nodes hurt export fidelity, and arc edges with control-point handles plus layered z-order fight the library.
- *tldraw SDK:* excellent, but production use needs a commercial license and its shape model is general-purpose whiteboard. We'd be forever working around it.
- *Konva / Fabric (Canvas2D):* raster output. Vector PDF/SVG export would need a second renderer.
- *Excalidraw:* hand-drawn aesthetic, and its embedding model doesn't suit a domain-specific editor.

**Cost accepted:** we implement hit-testing, selection, marquee, snapping and pan/zoom ourselves. That's roughly 2–3 weeks of focused work, scoped in the roadmap.

### D3: Fastify + Drizzle + Zod (not NestJS / Prisma)

- Fastify is fast and lightweight, with first-class TypeScript support and Zod integration. The API surface is small (projects, members, comments metadata, exports, imports), so NestJS's DI framework would mostly add ceremony.
- Drizzle produces SQL-like, type-safe queries with no code-generation step or binary engine, plays well with Docker images, and its migrations are plain SQL files that are easy to review.
- Zod schemas live in `@cld/shared` and are reused for API validation, client forms and OpenAPI generation (`zod-openapi`).

### D4: Better Auth

A self-hostable TypeScript auth library that stores sessions in our own Postgres. It covers email/password, magic links, OAuth (Google, GitHub, Microsoft, which suits universities), email verification and organizations. No external IdP is required. Lucia is deprecated, and Auth.js is centred on Next.js.

### D5: React 19 + Vite SPA (not Next.js)

The product is an authenticated app with a heavy canvas, so SEO and SSR bring little benefit. A static SPA served by Caddy keeps deployment simple and the dev loop fast. A marketing site, if one is needed, can be separate.

### D6: Tailwind v4 + shadcn/ui

Accessible Radix primitives (menus, dialogs, popovers, tooltips) that we own as source code, so they're easy to restyle into a clean, minimal look. Design tokens are CSS variables, which gives us light/dark themes for free.

### D7: One Yjs document per project

The project holds all its diagrams, layers, variables, comments and settings in one `Y.Doc`. Cross-diagram references (one variable shown in two views, as with Vensim "shadow" variables) stay consistent, project-wide undo/history is simple, and MDL import/export maps one-to-one onto a project. CLD projects are small (typically < 1 MB encoded), so loading the whole document is cheap. If that ever stops being true, split into Yjs *subdocuments* per diagram (see 14).

### D8: PostgreSQL for everything persistent

Relational metadata (users, projects, members, invites, versions) plus `bytea` Yjs snapshots in the same database means one backup and transactional consistency. Redis only holds ephemeral data. MinIO/S3 holds large or binary artifacts.

## Shared packages (why they matter)

| Package | Used by | Purpose |
|---------|---------|---------|
| `@cld/shared` | all | Zod schemas, types, constants, roles, error codes |
| `@cld/model` | web, collab, api | Yjs document schema, typed accessors, migrations, invariants |
| `@cld/geometry` | render, editor, mdl | Arc math, clipping, hit tests, bounding boxes |
| `@cld/render` | web, api | Pure SVG rendering of a diagram (string or React) |
| `@cld/mdl` | web, api | Vensim `.mdl` parser and writer |
| `@cld/analysis` | web, api | Loop detection, polarity classification, graph utilities |
