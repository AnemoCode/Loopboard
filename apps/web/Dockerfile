# syntax=docker/dockerfile:1
# Build context: repository root. Serves the SPA and reverse-proxies /api and /collab to the server.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/model/package.json packages/model/
COPY packages/render/package.json packages/render/
COPY packages/mdl/package.json packages/mdl/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cld/web...
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @cld/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80 443
