/**
 * The gateway's settings and its record. `~/.polaris/daemon.json` is the
 * Daemon's settings file (`{ "gateway": { "port": 7477 } }`), read once at
 * startup; `POLARIS_GATEWAY_PORT` overrides it for dev Daemons side by side,
 * and 0 asks for an ephemeral port. `~/.polaris/gateway.json` is
 * `{ port, nonce }` while the gateway listens: the port Remote Access proxies
 * to, and a nonce fresh at every start that `GET /polaris/identity` answers
 * with, so Remote Access can prove the port is this Daemon's before it sends
 * tokens that way (ENG-400).
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Effect, Option, Schema } from "effect";

export const GATEWAY_DEFAULT_PORT = 7477;

/** The WebSocket path; the Tailscale proxy keeps the prefix (ADR 0076). */
export const GATEWAY_PATH = "/polaris/rpc";

/** `GET` here answers `{ nonce }`, the one in `gateway.json`: no auth, nothing else. */
export const GATEWAY_IDENTITY_PATH = "/polaris/identity";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 }));

const DaemonConfig = Schema.Struct({
  gateway: Schema.optionalKey(Schema.Struct({ port: Schema.optionalKey(Port) })),
});

const decodeConfig = Schema.decodeUnknownOption(Schema.fromJsonString(DaemonConfig));

const decodePort = Schema.decodeUnknownOption(Schema.FiniteFromString.pipe(Schema.decodeTo(Port)));

/** The port the gateway should bind: the environment, then the settings file, then the default. */
export const configuredGatewayPort = Effect.fn("configuredGatewayPort")(function* (
  configPath: string,
  env: Record<string, string | undefined> = process.env
) {
  const fromEnv = env.POLARIS_GATEWAY_PORT;

  if (fromEnv !== undefined) {
    const port = decodePort(fromEnv);

    if (Option.isSome(port)) return port.value;
    yield* Effect.logWarning(`ignoring POLARIS_GATEWAY_PORT=${fromEnv}: not a port`);
  }

  if (!existsSync(configPath)) return GATEWAY_DEFAULT_PORT;
  const config = decodeConfig(readFileSync(configPath, "utf8"));

  if (Option.isNone(config)) {
    yield* Effect.logWarning(`ignoring ${configPath}: not the Daemon's settings`);

    return GATEWAY_DEFAULT_PORT;
  }

  return config.value.gateway?.port ?? GATEWAY_DEFAULT_PORT;
});

export const GatewayRecord = Schema.Struct({ port: Port, nonce: Schema.String });

export type GatewayRecord = typeof GatewayRecord.Type;

const encodeRecord = Schema.encodeSync(Schema.fromJsonString(GatewayRecord));

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayRecord));

/** 32 random bytes, base64url: new at every start of the gateway. */
export const newGatewayNonce = (): string => randomBytes(32).toString("base64url");

/** Writes the record atomically, readable by this user only, in a directory only they enter. */
export const writeGatewayRecord = (path: string, record: GatewayRecord): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${encodeRecord(record)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

/** The record, or null when there is none or it is not one (no gateway is running). */
export const readGatewayRecord = (path: string): GatewayRecord | null => {
  if (!existsSync(path)) return null;

  return Option.getOrNull(decodeRecord(readFileSync(path, "utf8")));
};

export const removeGatewayRecord = (path: string): void => {
  rmSync(path, { force: true });
};
