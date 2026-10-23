/**
 * The gateway Remote Access serves (ENG-399's contract): `root/gateway.json` holds the bound
 * port and a nonce new at every start; `GET /polaris/identity` on that port answers the nonce.
 * No file means no gateway. Swap `readGatewayRecord` for `gateway/index.ts`'s once both land.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";

/** The path prefix Remote Access serves; the gateway's RPC endpoint is under it. */
export const GATEWAY_PREFIX = "/polaris";

export const GATEWAY_RPC_PATH = `${GATEWAY_PREFIX}/rpc`;

const IDENTITY_TIMEOUT_MS = 1_500;

const GatewayRecord = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  nonce: Schema.String.check(Schema.isMinLength(1)),
});

export type GatewayRecord = typeof GatewayRecord.Type;

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayRecord));

const decodeIdentity = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ nonce: Schema.String }))
);

/** The running gateway's record; null when absent or malformed. */
export const readGatewayRecord = (root: string): GatewayRecord | null => {
  try {
    return Option.getOrNull(decodeRecord(readFileSync(join(root, "gateway.json"), "utf8")));
  } catch {
    return null;
  }
};

const sameNonce = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

/** The nonce the process on `port` answers with; null when it answers anything else. */
const askNonce = async (port: number): Promise<string | null> => {
  const response = await fetch(`http://127.0.0.1:${port}${GATEWAY_PREFIX}/identity`, {
    signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
  });

  if (!response.ok) return null;

  return Option.match(decodeIdentity(await response.text()), {
    onNone: () => null,
    onSome: ({ nonce }) => nonce,
  });
};

/**
 * The record of a gateway that proved it wrote it, or null: whatever else holds the port
 * (another user's process, a stale record) is never served to the tailnet.
 */
export const runningGateway = (root: string): Effect.Effect<GatewayRecord | null> => {
  const record = readGatewayRecord(root);

  if (record === null) return Effect.succeed(null);

  return Effect.tryPromise(() => askNonce(record.port)).pipe(
    Effect.map((nonce) => (nonce !== null && sameNonce(nonce, record.nonce) ? record : null)),
    Effect.orElseSucceed(() => null)
  );
};

/** What `tailscale serve` proxies to: the prefix it strips, put back. */
export const serveTarget = (port: number): string => `http://127.0.0.1:${port}${GATEWAY_PREFIX}`;
