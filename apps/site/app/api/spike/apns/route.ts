// ENG-461 spike: an APNs provider token signed by Vercel KMS. Not product code; see README.md.
import { createHash, timingSafeEqual } from "node:crypto";
import { Schema } from "effect";

import { sendPush } from "./_lib/apns";
import { cachedProviderToken } from "./_lib/token";

export const runtime = "nodejs";

// SHA-256 of the spike secret; the secret itself stays on the operator's machine.
const SECRET_SHA256 = "cd69573aa2870ce6306247347ba8e0f0f97dea79192a478a8697f22e74b5c6d5";

const Body = Schema.Struct({
  issuerId: Schema.String,
  teamId: Schema.String,
  keyId: Schema.String,
  topic: Schema.String,
  deviceToken: Schema.String,
  mode: Schema.Literals(["message", "jwt"]),
});

const decodeBody = Schema.decodeUnknownSync(Body);

const authorized = (request: Request): boolean => {
  const given = createHash("sha256")
    .update(request.headers.get("x-spike-secret") ?? "")
    .digest();

  return timingSafeEqual(given, Buffer.from(SECRET_SHA256, "hex"));
};

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV === "production" || !authorized(request)) {
    return new Response(null, { status: 404 });
  }

  const body = decodeBody(await request.json());
  const config = { issuerId: body.issuerId, teamId: body.teamId, keyId: body.keyId };

  try {
    const { token, ...signed } = await cachedProviderToken(config, body.mode);

    const apns = await sendPush({
      providerToken: token,
      deviceToken: body.deviceToken,
      topic: body.topic,
    });

    return Response.json({ region: process.env.VERCEL_REGION ?? null, signed, apns });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502 });
  }
}
