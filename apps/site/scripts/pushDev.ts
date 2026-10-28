#!/usr/bin/env bun
/**
 * The push route on a local port with a fake provider token and APNs endpoints from the
 * environment, for end-to-end tests against a fake APNs (no KMS, never Apple):
 * PORT, POLARIS_PUSH_SECRET, POLARIS_PUSH_APNS_SANDBOX, POLARIS_PUSH_APNS_PRODUCTION.
 */
import { createPushHandler } from "../app/api/push/_lib";
import { http2Apns } from "../app/api/push/_lib/apns";
import { PREVIEW } from "../app/api/push/_lib/environment";
import { memoryStore } from "../app/api/push/_lib/store";
import { providerTokens } from "../app/api/push/_lib/token";

const env = process.env;

const store = memoryStore();

const handler = createPushHandler({
  secret: env.POLARIS_PUSH_SECRET ?? null,
  deployment: { ...PREVIEW, delivers: ["sandbox", "production"] },
  store,
  tokens: providerTokens({ store, sign: async () => "dev-provider-token" }),
  send: http2Apns(),
  apnsHosts: {
    sandbox: env.POLARIS_PUSH_APNS_SANDBOX ?? "http://127.0.0.1:1",
    production: env.POLARIS_PUSH_APNS_PRODUCTION ?? "http://127.0.0.1:1",
  },
});

const server = Bun.serve({
  port: Number(env.PORT ?? 0),
  hostname: "127.0.0.1",
  fetch: (request) => handler(request, {}),
});

console.log(JSON.stringify({ event: "push.dev.start", port: server.port }));
