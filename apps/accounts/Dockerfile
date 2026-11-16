# syntax=docker/dockerfile:1.7-labs
# The Polaris Account Server. Build from the repository root:
#   docker build -f apps/accounts/Dockerfile -t polaris-accounts .
# Keep the Bun tag in step with the root package.json's packageManager.
FROM oven/bun:1.4.4 AS build
WORKDIR /src
# The lockfile covers every workspace, so their manifests come along; only the accounts' deps install.
COPY package.json bun.lock ./
COPY patches patches
COPY --parents apps/*/package.json packages/*/package.json extensions/*/package.json tooling/package.json ./
RUN bun install --frozen-lockfile --ignore-scripts --filter @polaris/accounts
COPY apps/accounts apps/accounts
RUN bun build apps/accounts/src/main.ts --target bun --outfile /out/server.js

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build /out/server.js server.js
COPY apps/accounts/drizzle drizzle
ENV MIGRATIONS_DIR=/app/drizzle
ENV PORT=3000
EXPOSE 3000
USER bun
CMD ["bun", "server.js"]
