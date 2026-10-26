import { createHmac } from "node:crypto";
import { Option, Schema } from "effect";
import { Base64Url32 } from "./config.ts";

export const IDENTITY_BODY_LIMIT = 256;

const BODY_DEADLINE_MS = 5_000;

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ challenge: Base64Url32 })),
  { onExcessProperty: "error" }
);

/** Proof of the file's secret: both key and message are decoded 32-byte values. */
export const identityResponse = async (request: Request, secret: string): Promise<Response> => {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return new Response("Expected application/json", { status: 415 });
  const reader = request.body?.getReader();

  if (reader === undefined) return new Response("Expected a challenge", { status: 400 });
  let expired = false;

  const deadline = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, BODY_DEADLINE_MS);

  try {
    const parts: Array<Uint8Array> = [];
    let size = 0;

    while (true) {
      const chunk = await reader.read();

      if (expired) return new Response("Challenge timed out", { status: 408 });

      if (chunk.done) break;
      const bytes = Schema.decodeUnknownSync(Schema.Uint8Array)(chunk.value);
      size += bytes.byteLength;

      if (size > IDENTITY_BODY_LIMIT) {
        await reader.cancel();

        return new Response("Challenge too large", { status: 413 });
      }

      parts.push(bytes);
    }

    const body = decode(Buffer.concat(parts).toString("utf8"));

    if (Option.isNone(body)) return new Response("Invalid challenge", { status: 400 });

    const mac = createHmac("sha256", Buffer.from(secret, "base64url"))
      .update(Buffer.from(body.value.challenge, "base64url"))
      .digest("base64url");

    return Response.json({ mac }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("Invalid challenge", { status: expired ? 408 : 400 });
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
};
