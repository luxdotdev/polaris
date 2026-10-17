import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  type Capability,
  HostId,
  HostInfo,
  LEGACY_PLATFORMS,
  Platform,
  PROTOCOL_VERSION,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { ServiceError } from "../services.ts";
import { VERSION } from "../service/platform.ts";
import { buildOsOf, HostPlatform, wireLibcOf } from "../platform/index.ts";

/** The Daemon's version; `polaris version` and `hello` report it. */
export const DAEMON_VERSION = VERSION;

const platformOf = (os: string, arch: string) =>
  Schema.decodeUnknownEffect(Platform)(`${buildOsOf(os)}-${arch}`).pipe(
    Effect.mapError(
      () =>
        new ServiceError({
          service: "transport",
          message: `unsupported platform ${os}-${arch}`,
        })
    )
  );

/**
 * A stable id for this Host, created on first run under the Polaris home and
 * kept across Daemon upgrades, so Clients can tell Hosts apart even when two
 * SSH aliases point at the same machine.
 */
export const loadHostId = (root: string) =>
  Effect.try({
    try: () => {
      const file = join(root, "host-id");

      try {
        const existing = readFileSync(file, "utf8").trim();

        if (existing.length > 0) return existing;
      } catch {}

      mkdirSync(root, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      writeFileSync(file, `${id}\n`, { mode: 0o600, flag: "w" });

      return id;
    },
    catch: (cause) =>
      new ServiceError({ service: "transport", message: "cannot read host id", cause }),
  });

export const loadHostInfo = Effect.fnUntraced(function* (root: string) {
  const hostId = yield* loadHostId(root);
  const facts = yield* HostPlatform;
  const platform = yield* platformOf(facts.os, facts.arch);
  const libc = wireLibcOf(facts);

  const fields = {
    hostId: HostId.make(hostId),
    hostname: hostname(),
    platform,
    daemonVersion: DAEMON_VERSION,
    homeDir: homedir(),
    startedAt: new Date().toISOString(),
  };

  return libc === undefined ? new HostInfo(fields) : new HostInfo({ ...fields, libc });
});

const isLegacyPlatform = (platform: string) => LEGACY_PLATFORMS.some((known) => known === platform);

/**
 * The Host and protocol version `hello` answers a Client with. A Client without
 * `host.any-platform` can't decode a newer platform, so it gets a newer protocol
 * version, which it reports as "update this app" before it reads the Host (ADR 0059).
 */
export const helloHost = (host: HostInfo, clientCapabilities: ReadonlyArray<Capability>) => {
  if (isLegacyPlatform(host.platform) || clientCapabilities.includes("host.any-platform"))
    return { host, protocolVersion: PROTOCOL_VERSION };

  // A placeholder the older Client decodes and never reads: it stops at the version.
  const placeholder = Schema.decodeSync(HostInfo)({
    ...Schema.encodeSync(HostInfo)(host),
    platform: LEGACY_PLATFORMS[0],
  });

  return { host: placeholder, protocolVersion: PROTOCOL_VERSION + 1 };
};
