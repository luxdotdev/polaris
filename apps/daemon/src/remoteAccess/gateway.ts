/**
 * The gateway Remote Access serves (ENG-399): `root/gateway.json` (0600) holds the bound port
 * and a secret new at every start. The gateway proves it holds the secret by answering a fresh
 * challenge with its HMAC, so nothing replayable is ever exposed. No file means no gateway.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { GATEWAY_IDENTITY_PATH, GATEWAY_PATH } from "../gateway/index.ts";

/** The path prefix Remote Access serves; the gateway's routes are under it. */
export const GATEWAY_PREFIX = "/polaris";

export const GATEWAY_RPC_PATH = GATEWAY_PATH;

const IDENTITY_TIMEOUT_MS = 1_500;

const Base64Url32 = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));

/** Swap for `gateway/index.ts`'s `readGatewayRecord` once its record carries the secret. */
const GatewayRecord = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  secret: Base64Url32,
});

export type GatewayRecord = typeof GatewayRecord.Type;

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayRecord));

const decodeProof = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ mac: Schema.String }))
);

/** The running gateway's record; null when absent or malformed. */
export const readGatewayRecord = (root: string): GatewayRecord | null => {
  try {
    return Option.getOrNull(decodeRecord(readFileSync(join(root, "gateway.json"), "utf8")));
  } catch {
    return null;
  }
};

/** HMAC-SHA256 keyed by the secret's bytes over the challenge's bytes, base64url. */
export const identityMac = (secret: string, challenge: string): string =>
  createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(Buffer.from(challenge, "base64url"))
    .digest("base64url");

const sameMac = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

/** The MAC the process on `port` answers `challenge` with; null when it answers anything else. */
const askMac = async (port: number, challenge: string): Promise<string | null> => {
  const response = await fetch(`http://127.0.0.1:${port}${GATEWAY_IDENTITY_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge }),
    signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
  });

  if (!response.ok) return null;

  return Option.match(decodeProof(await response.text()), {
    onNone: () => null,
    onSome: ({ mac }) => mac,
  });
};

/**
 * The record of a gateway that proved it holds the record's secret, or null: whatever else
 * holds the port (another user's process, a stale record) is never served to the tailnet.
 */
export const runningGateway = (root: string): Effect.Effect<GatewayRecord | null> => {
  const record = readGatewayRecord(root);

  if (record === null) return Effect.succeed(null);
  const challenge = randomBytes(32).toString("base64url");

  return Effect.tryPromise(() => askMac(record.port, challenge)).pipe(
    Effect.map((mac) =>
      mac !== null && sameMac(mac, identityMac(record.secret, challenge)) ? record : null
    ),
    Effect.orElseSucceed(() => null)
  );
};

/** What `tailscale serve` proxies to: the prefix it strips, put back. */
export const serveTarget = (port: number): string => `http://127.0.0.1:${port}${GATEWAY_PREFIX}`;
