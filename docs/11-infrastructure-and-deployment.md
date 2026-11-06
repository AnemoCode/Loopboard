# 11: Infrastructure, Docker & Deployment

## Container images

Every app has a **multi-stage Dockerfile** built from the repo root (it needs the workspace packages), using `turbo prune` to keep the build context minimal.

```dockerfile
# apps/api/Dockerfile (pattern shared by collab)
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @cld/api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo build --filter=@cld/api... && pnpm deploy --filter=@cld/api --prod /app

FROM node:24-alpine AS runner
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder --chown=app:app /app .
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "dist/server.js"]
```

- **web:** the builder runs `vite build`, and the runner is `caddy:2-alpine` serving `/srv` with SPA fallback. Hashed assets get `Cache-Control: immutable`, while `index.html` gets `no-cache`.
- **worker:** the same image as `api` with `CMD ["node", "dist/worker.js"]`. It includes the font files for resvg.
- Images are non-root, use a read-only root filesystem where possible, carry `org.opencontainers` labels, and are scanned with Trivy in CI.
- Multi-arch builds (amd64 + arm64) with buildx, so they run on Apple Silicon dev machines and ARM servers.

## Compose: production-like (`compose.yaml`)

```yaml
name: loopboard
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [web, api, collab]

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      minio:    { condition: service_healthy }

  migrate:                     # one-shot, runs drizzle migrations then exits
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ["node", "dist/migrate.js"]
    env_file: .env
    depends_on: { postgres: { condition: service_healthy } }
    restart: "no"

  worker:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ["node", "dist/worker.js"]
    env_file: .env
    depends_on: [postgres, minio]

  collab:
    build: { context: ., dockerfile: apps/collab/Dockerfile }
    env_file: .env
    depends_on: [postgres, redis]
    deploy: { replicas: 1 }

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: cld
      POSTGRES_USER: cld
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pg_data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U cld"], interval: 5s, retries: 10 }

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "no"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s }

  minio:
    image: minio/minio:latest   # pin a release tag at scaffolding
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    volumes: [minio_data:/data]
    healthcheck: { test: ["CMD", "mc", "ready", "local"], interval: 5s }

volumes: { pg_data: {}, minio_data: {}, caddy_data: {} }
```

### Caddyfile
```
{$DOMAIN:localhost} {
  encode zstd gzip
  handle /api/*    { reverse_proxy api:3000 }
  handle /collab*  { reverse_proxy collab:4000 }   # WebSocket upgrade handled automatically
  handle           { reverse_proxy web:80 }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Content-Security-Policy "default-src 'self'; connect-src 'self' wss:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
  }
}
```

## Compose: development (`compose.dev.yaml`)

`docker compose -f compose.yaml -f compose.dev.yaml up`:
- `web` runs `pnpm --filter @cld/web dev` (Vite HMR) with the source bind-mounted, `node_modules` in a named volume, port 5173.
- `api` / `collab` run `tsx watch` with the source mounted, ports 3000/4000 exposed, and a debugger on 9229/9230.
- Postgres 5432, Redis 6379, MinIO 9000/9001 exposed to the host.
- **Mailpit** (port 8025) catches auth/invite emails.
- A `seed` service creates demo users (`alice@example.com`, `bob@example.com`, password `password`) and a demo project imported from the fixture `.mdl`.

Developers can also run the apps on the host (`pnpm dev`, all apps through turbo) and use only the infrastructure from compose: `docker compose up postgres redis minio mailpit`.

## Environment variables (`.env.example`)

```
DOMAIN=localhost
PUBLIC_URL=https://localhost
DATABASE_URL=postgres://cld:changeme@postgres:5432/cld
POSTGRES_PASSWORD=changeme
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_BUCKET=cld
S3_ACCESS_KEY=minio
S3_SECRET_KEY=changeme123
BETTER_AUTH_SECRET=<32+ random bytes>
COLLAB_JWT_SECRET=<32+ random bytes>
COLLAB_INTERNAL_TOKEN=<random>          # api → collab direct connection
SMTP_URL=smtp://mailpit:1025
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID= / GITHUB_CLIENT_SECRET=
MICROSOFT_CLIENT_ID= / MICROSOFT_CLIENT_SECRET=
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
LOG_LEVEL=info
```
All variables are validated at startup with Zod, and the app fails fast with a clear message.

## Environments

| Env | Where | Deploy trigger |
|-----|-------|----------------|
| local | Docker Compose dev | n/a |
| preview (optional) | Ephemeral compose stack per PR on a cheap VM | PR label |
| staging | Single VM (e.g. Hetzner CX32), compose.yaml | merge to `main` |
| production | Same compose setup at first. Move to k8s/Nomad only when > 1 VM is needed | Git tag `v*` |

The compose setup is enough for hundreds of concurrent users on one 4-vCPU VM. Scaling path: (1) separate managed Postgres, (2) N collab replicas behind Caddy with `lb_policy header`/cookie stickiness, plus the Redis extension, (3) N api replicas, (4) Kubernetes Helm chart (phase 4+, see roadmap).

## CI/CD (GitHub Actions)

```
on: [pull_request, push to main, tags v*]
jobs:
  check:   pnpm install → turbo lint typecheck test (with turbo remote cache)
  e2e:     docker compose -f compose.yaml -f compose.ci.yaml up -d → playwright (2 browsers collab specs)
  build:   buildx bake → push ghcr.io/<org>/cld-{web,api,collab}:{sha,branch,semver}
  scan:    trivy image (fail on HIGH/CRITICAL with fix available)
  deploy:  (main→staging, tag→prod) ssh to the VM → docker compose pull && docker compose up -d → smoke test /api/ready
```
Migrations run as the `migrate` one-shot service before `api` starts (`depends_on: migrate: condition: service_completed_successfully`). Migrations must be backwards-compatible (expand/contract), so rolling restarts are safe.

## Backups & disaster recovery

- Postgres: nightly `pg_dump` (compressed) to off-site S3 with 30-day retention, plus continuous WAL archiving with `wal-g` for point-in-time recovery (phase 3).
- MinIO: bucket replication or nightly `mc mirror` off-site. Thumbnails can be regenerated, so only uploads matter.
- Restore drills every quarter, documented in `docs/runbooks/restore.md` (to be written in phase 3).
- RPO ≤ 24 h (≤ 5 min with WAL), RTO ≤ 2 h.

## Observability

- Structured logs (pino) → docker logging driver → Loki (optional) or plain `docker logs`.
- Metrics: `/metrics` on api and collab (prom-client): active connections, documents loaded, update rate, store latency, export durations.
- Traces: OpenTelemetry auto-instrumentation (http, pg, redis) → any OTLP backend.
- Frontend errors: Sentry (or the self-hosted GlitchTip).
- Uptime: external ping on `/api/ready`.
