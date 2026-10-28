# The Polaris Relay. Build from the repository root:
#   docker build -f apps/relay/Dockerfile -t polaris-relay .
FROM oven/bun:1.4.4-slim AS install
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @polaris/relay

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=install /repo/package.json ./package.json
COPY --from=install /repo/node_modules ./node_modules
COPY --from=install /repo/packages/protocol ./packages/protocol
COPY --from=install /repo/apps/relay ./apps/relay
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER bun
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "apps/relay/src/main.ts"]
