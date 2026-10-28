import { signJWT } from "@vercel/kms";
import { withWideEvent } from "../../../lib/log";
import { createPushHandler } from "./_lib";
import { http2Apns } from "./_lib/apns";
import { APNS_TEAM_ID, pushDeployment } from "./_lib/environment";
import { memoryStore, readSharedStore } from "./_lib/store";
import { providerTokens } from "./_lib/token";

export const runtime = "nodejs";

const store = readSharedStore(process.env) ?? memoryStore();

const handler = createPushHandler({
  secret: process.env.POLARIS_PUSH_SECRET?.trim() || null,
  deployment: pushDeployment(process.env.VERCEL_ENV),
  store,
  tokens: providerTokens({
    store,
    sign: async ({ issuerId, keyId }) =>
      (
        await signJWT({
          issuerId,
          claims: { iss: APNS_TEAM_ID },
          headers: { kid: keyId },
          ttl: 3600,
        })
      ).token,
  }),
  send: http2Apns(),
});

export const POST = withWideEvent("/api/push", (request, event) => handler(request, event));
