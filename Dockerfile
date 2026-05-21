FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile

FROM base AS web-build
RUN pnpm --filter web build

FROM node:20-alpine AS web
WORKDIR /app/apps/web
COPY --from=web-build /app/apps/web/.next ./.next
COPY --from=web-build /app/apps/web/public ./public
COPY --from=web-build /app/apps/web/package.json ./package.json
COPY --from=web-build /app/node_modules /app/node_modules
COPY --from=web-build /app/packages /app/packages
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start"]

FROM base AS ws-server
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "apps/ws-server/src/index.ts"]

FROM base AS outbox-worker
CMD ["node_modules/.bin/tsx", "apps/outbox-worker/src/index.ts"]

FROM base AS rebalance-worker
CMD ["node_modules/.bin/tsx", "apps/outbox-worker/src/rebalance-worker.ts"]
