FROM node:24.19.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile --filter @avalon/server... \
  --config.confirmModulesPurge=false

COPY apps/server apps/server
COPY packages/protocol packages/protocol
RUN pnpm --filter @avalon/protocol build \
  && pnpm --filter @avalon/server build \
  && pnpm --filter @avalon/server deploy --prod /prod/server

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/server ./

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
