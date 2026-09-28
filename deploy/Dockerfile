# syntax=docker/dockerfile:1
# Images of the 2P Crew VPS stack, built from the monorepo root (see deploy/compose.yml):
#   target api    Fastify API (non-root, production deps only)
#   target web    the built SPA on an unprivileged nginx
#   target backup pg_dump/pg_restore tooling for nightly dumps and restores
ARG NODE_IMAGE=node:22-bookworm-slim
ARG POSTGRES_IMAGE=postgres:17
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:stable-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Everything needed to compile shared, api and web. Install scripts stay off: the only package with one is
# better-sqlite3 (a drizzle-orm peer resolved for the daemon), which neither the API nor the web loads.
FROM base AS build
RUN --mount=type=cache,id=crew-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @crew/api... --filter @crew/web...
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @crew/shared build && pnpm --filter @crew/api build && pnpm --filter @crew/web build

# Runtime dependencies of the API only.
FROM base AS api-deps
RUN --mount=type=cache,id=crew-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --prod --filter @crew/api...

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh
WORKDIR /app
COPY --from=api-deps /repo/node_modules node_modules
COPY --from=api-deps /repo/packages/shared/node_modules packages/shared/node_modules
COPY --from=api-deps /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/drizzle apps/api/drizzle
# Small operator tools (the shared-nginx override editor) that reuse the API's yaml dependency.
COPY deploy/tools /app/deploy-tools
WORKDIR /app/apps/api
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]

FROM ${NGINX_IMAGE} AS web
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

FROM ${POSTGRES_IMAGE} AS backup
ENV TZ=Asia/Ho_Chi_Minh
# The named volume mounted here inherits this ownership on first use.
RUN mkdir -p /backups && chown postgres:postgres /backups && chmod 0700 /backups
COPY --chmod=0755 deploy/backup/backup.sh /usr/local/bin/crew-backup
USER postgres
ENTRYPOINT ["/usr/local/bin/crew-backup"]
CMD ["loop"]
