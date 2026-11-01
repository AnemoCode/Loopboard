# syntax=docker/dockerfile:1
# Build context: repository root.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/model/package.json packages/model/
COPY packages/render/package.json packages/render/
COPY packages/mdl/package.json packages/mdl/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cld/server...
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @cld/server build \
 && pnpm --filter @cld/server deploy --prod --legacy /out \
 && cp -r apps/server/dist apps/server/drizzle /out/

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
