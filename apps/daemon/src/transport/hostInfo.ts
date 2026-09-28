import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { HostId, HostInfo, Platform } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { ServiceError } from "../services.ts";

/** The Daemon's version; `polaris version` and `hello` report it. */
export const DAEMON_VERSION = "0.0.0";

const platformOf = (os: string, arch: string) =>
  Schema.decodeUnknownEffect(Platform)(`${os}-${arch}`).pipe(
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
const loadHostId = (root: string) =>
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
  const platform = yield* platformOf(process.platform, process.arch);
  return new HostInfo({
    hostId: HostId.make(hostId),
    hostname: hostname(),
    platform,
    daemonVersion: DAEMON_VERSION,
    homeDir: homedir(),
    startedAt: new Date().toISOString(),
  });
});
