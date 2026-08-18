FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile --filter @avalon/server... \
  --config.confirmModulesPurge=false

COPY apps/server apps/server
COPY packages/game-engine packages/game-engine
COPY packages/protocol packages/protocol
RUN pnpm --filter @avalon/protocol build \
  && pnpm --filter @avalon/game-engine build \
  && pnpm --filter @avalon/server build \
  && pnpm --filter @avalon/server deploy --prod /prod/server

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime-base

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/server ./

USER node
EXPOSE 3000

FROM runtime-base AS migrator

CMD ["node", "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "--migrations-dir", "migrations", "up"]

FROM runtime-base AS runtime

CMD ["node", "dist/main.js"]
