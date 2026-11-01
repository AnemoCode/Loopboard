# Loopwise

Real-time collaborative **causal loop diagrams** in the browser, with Vensim `.mdl` import and export.

- **Draw** variables, causal links (curved like Vensim, with + / – polarity, delay marks and labels), R/B loop markers (clockwise or counter-clockwise), shapes and text.
- **Collaborate live:** see everyone's cursor, selection and in-progress drags; follow a teammate's view; leave threaded comments.
- **No account needed to join:** share a link — collaborators just type their name (and can create an account later to keep access).
- **Follow what changed:** a live History panel lists who changed what (moves grouped, everything else itemised) next to saved versions.
- **Organise:** many projects, several diagrams (views) per project, and layers within a diagram.
- **Analyse:** feedback loops are detected automatically and classified as reinforcing or balancing.
- **Interoperate:** import Vensim `.mdl` files and export them back unchanged; export PNG, SVG and vector PDF.
- **Stay safe:** owner / editor / commenter / viewer roles, invite links, version history with restore.

## Quick start (Docker)

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET in .env, e.g.:  openssl rand -base64 32
docker compose up -d --build
open http://localhost:8080
```

To serve on a real domain with automatic HTTPS, set `SITE_ADDRESS=your.domain`, `PUBLIC_URL=https://your.domain`, `HTTP_PORT=80` and `HTTPS_PORT=443` in `.env`.

## Deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs CI, builds arm64 images to `ghcr.io/anemocode/loopwise-{server,web}` and deploys
`docker-compose.prod.yml` over SSH to `/opt/loopwise` (secrets: `DEPLOY_SSH_KEY`, `SERVER_HOST`, `SERVER_USER`).

1. Once, on the server: `cp /opt/loopwise/.env.example /opt/loopwise/.env` and fill it in (the first deploy copies
   the example there and then stops, asking for `.env`).
2. In Nginx Proxy Manager, add a proxy host for your domain → `http://<server>:18473` with **Websockets Support** on
   (needed for live collaboration) and an SSL certificate. `PUBLIC_URL` must be exactly that `https://` domain.

## Development

Requirements: Node 24, pnpm (via `corepack enable`), Docker.

```bash
pnpm install
docker compose -f compose.dev.yaml up -d   # Postgres on localhost:5433
pnpm dev                                    # API on :3000, web on http://localhost:5173
```

Dev settings come from `.env.development`. Put personal overrides in `.env.local`.

| Command | What it does |
|---------|--------------|
| `pnpm test` | Unit and integration tests (needs the dev Postgres running) |
| `pnpm test:e2e` | Playwright end-to-end tests against `BASE_URL` (default: the dev server) |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality |
| `pnpm build` | Production builds of all packages |

To run the end-to-end tests against the Docker stack:

```bash
DISABLE_RATE_LIMIT=true BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up -d --build --wait
BASE_URL=http://localhost:8080 pnpm test:e2e
```

## Project layout

```
apps/
  server/     Fastify API + Better Auth + Hocuspocus (Yjs) + Drizzle/Postgres
  web/        React 19 + Vite + Tailwind editor and dashboard (served by Caddy in production)
packages/
  model/      Yjs document schema, editing commands, invariant repair, loop analysis
  render/     Layout + deterministic SVG renderer (shared by canvas, exports and thumbnails)
  mdl/        Vensim .mdl parser/writer (+ fixtures)
  shared/     API types, roles
e2e/          Playwright tests (incl. multi-user collaboration)
docs/         Architecture plan (01–14) and implementation notes (15)
```

Start with [`docs/15-implementation-notes.md`](docs/15-implementation-notes.md) for how it is built and why.
