/**
 * Gateway settings and the private identity record (ADR 0076).
 * daemon.json sets the port; gateway.json holds a fresh HMAC key per start.
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

/** `POST` here proves possession of the private secret without disclosing it. */
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

export const Base64Url32 = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
);

export const GatewayRecord = Schema.Struct({ port: Port, secret: Base64Url32 });

export type GatewayRecord = typeof GatewayRecord.Type;

const encodeRecord = Schema.encodeSync(Schema.fromJsonString(GatewayRecord));

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayRecord));

/** 32 random bytes, base64url: new at every start of the gateway. */
export const newGatewaySecret = (): string => randomBytes(32).toString("base64url");

/** Writes the record atomically, readable by this user only, in a directory only they enter. */
export const writeGatewayRecord = (path: string, record: GatewayRecord): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;

  try {
    writeFileSync(temporary, `${encodeRecord(record)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
};

/** The record, or null when there is none or it is not one (no gateway is running). */
export const readGatewayRecord = (path: string): GatewayRecord | null => {
  if (!existsSync(path)) return null;

  return Option.getOrNull(decodeRecord(readFileSync(path, "utf8")));
};

export const removeGatewayRecord = (path: string): void => {
  rmSync(path, { force: true });
};
