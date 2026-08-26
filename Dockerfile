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
RUN pnpm build

FROM node:24-alpine AS runtime
RUN apk add --no-cache ca-certificates tini
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4310/api/health || exit 1
ENTRYPOINT ["node", "/app/packages/cli/dist/index.js"]
CMD ["serve", "/board", "--host", "0.0.0.0", "--no-open"]
