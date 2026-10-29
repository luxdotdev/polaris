/**
 * Where a Daemon listens on its own machine, which the Daemon, `polaris bridge`
 * and every local Client compute the same way: a Unix socket in the Polaris
 * home, or on Windows a named pipe derived from it (ADR 0059).
 * `import { localEndpoint } from "@polaris/protocol/endpoint"`; it loads no schemas.
 */
import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

/** The prefix every Windows Daemon pipe shares; the rest is a hash of the Polaris home. */
export const PIPE_PREFIX = "\\\\.\\pipe\\polaris-";

/**
 * The pipe for a Polaris home: the pipe namespace is machine-wide, so the name
 * hashes the home, which differs per user and per `POLARIS_HOME`. Case and a
 * trailing separator don't change it, as they don't change the directory.
 */
export const windowsPipeName = (root: string): string => {
  const normalized = win32
    .resolve(root)
    .replace(/[\\/]+$/, "")
    .toLowerCase();

  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 32);

  return `${PIPE_PREFIX}${digest}`;
};

/** Whether `path` names a Windows named pipe rather than a file. */
export const isPipePath = (path: string): boolean => /^[\\/]{2}[.?][\\/]pipe[\\/]/i.test(path);

/** The local endpoint of the Daemon whose Polaris home is `root`. */
export const localEndpoint = (root: string, platform: string = process.platform): string =>
  platform === "win32" ? windowsPipeName(root) : posix.join(root, "daemon.sock");

/** The LaunchAgent's label, for `polaris install` and a Client's Restart daemon (ADR 0087). */
export const LAUNCHD_LABEL = "dev.lux.polaris";

/** The `systemd --user` unit, for `polaris install` and a Client's Restart daemon. */
export const SYSTEMD_UNIT = "polaris.service";
