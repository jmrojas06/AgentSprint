# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
RUN npm i -g pnpm@11
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile
COPY packages packages
# The image has no .git: pass the commit in (pnpm docker:up does) so
# /api/health and the UI can tell this build apart from the current code.
ARG AGENTBOARD_COMMIT=""
ENV AGENTBOARD_COMMIT=${AGENTBOARD_COMMIT}
RUN pnpm build

FROM node:24-alpine AS runtime
# git: commit links (/api/git/*) shell out to it.
RUN apk add --no-cache ca-certificates tini git \
  && git config --system --add safe.directory '*'
WORKDIR /app
COPY --from=build --chown=node:node /app .
ENV NODE_ENV=production
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4310/api/health || exit 1
# Run as the image's `node` user (uid 1000), not root: the board is a bind
# mount of your repos, and files written as root there are no longer yours.
# Another host uid? Set `user: "<uid>:<gid>"` in docker-compose.override.yml.
USER node
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/packages/cli/dist/index.js"]
CMD ["serve", "/board", "--host", "0.0.0.0", "--no-open"]
