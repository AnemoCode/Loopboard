# Loopwise: Collaborative Causal Loop Diagrams (Planning Docs)

> Working title: **Loopwise**. Rename freely. Everything here uses `cld` / `@cld/*` as the internal package prefix.

A browser-based, real-time collaborative editor for **causal loop diagrams (CLDs)**: the "Figma for system-dynamics sketches". It replaces the sketching part of Vensim, so it needs to import and export Vensim `.mdl` files without losing information.

## Document index

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [Vision & Scope](01-vision-and-scope.md) | Who it's for, what's in and out, success criteria |
| 02 | [Tech Stack](02-tech-stack.md) | Every technology choice, with the reasons and the alternatives we rejected |
| 03 | [Architecture](03-architecture.md) | Services, monorepo layout, how data flows |
| 04 | [Data Model](04-data-model.md) | Postgres schema + Yjs document schema |
| 05 | [Real-time Collaboration](05-realtime-collaboration.md) | CRDT sync, presence, cursors, live drag, undo, offline |
| 06 | [Editor & UX](06-editor-and-ux.md) | UI layout, tools, interactions, shortcuts, styling, design system |
| 07 | [Vensim MDL Format](07-mdl-format.md) | Reverse-engineered format spec + mapping to our model |
| 08 | [Import & Export](08-import-export.md) | MDL, PNG, SVG, PDF, JSON pipelines |
| 09 | [API](09-api.md) | REST + WebSocket endpoints |
| 10 | [Security & Permissions](10-security-and-permissions.md) | Auth, roles, sharing, threat model |
| 11 | [Infrastructure & Docker](11-infrastructure-and-deployment.md) | Containers, compose files, environments, CI/CD, backups |
| 12 | [Testing & Quality](12-testing-and-quality.md) | Test strategy, fixtures, performance budgets |
| 13 | [Roadmap](13-roadmap.md) | Phased delivery plan with tasks and acceptance criteria |
| 14 | [Risks & Open Questions](14-risks-and-open-questions.md) | What could go wrong, and the decisions still open |

## TL;DR of the key decisions

- **Monorepo:** pnpm workspaces + Turborepo, all TypeScript.
- **Frontend:** React 19 + Vite, with a **custom SVG canvas engine**. Rendering lives in a pure `@cld/render` package, so screen output and exported files come from the same code. Styling uses Tailwind CSS v4 + shadcn/ui (Radix), and Zustand holds local UI state.
- **Real-time:** **Yjs** CRDT synced through **Hocuspocus** (WebSocket). Presence data (cursors, selections, in-progress drags) travels over the Yjs *awareness* protocol, and Redis handles fan-out between collab instances.
- **Backend:** Node.js LTS + **Fastify** + **Zod** + **Drizzle ORM**. **Better Auth** handles sign-in (email/password, OAuth, magic link).
- **Storage:** **PostgreSQL** (metadata + Yjs binary snapshots), **Redis** (pub/sub, rate limits), **MinIO/S3** (thumbnails, export artifacts, uploads).
- **Vensim interop:** our own `@cld/mdl` parser/writer, written against real fixtures. Unknown sections are kept verbatim so a round-trip loses nothing.
- **Export:** PNG / SVG / PDF are generated on the client from the shared renderer. The same renderer also runs headless in the API, for server-side exports and thumbnails.
- **Docker:** a multi-stage image per app, `compose.yaml` for production-like runs, and `compose.dev.yaml` with hot reload. Caddy is the reverse proxy and provides automatic TLS.

## Reference material in this repo

- `338358-76591 - Group 32 - … .mdl`: a real Vensim CLD (22 variables, ~30 links, 4 loop markers). It becomes fixture `packages/mdl/test/fixtures/coffee-agroforestry.mdl`. See [07](07-mdl-format.md).
