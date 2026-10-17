/**
 * Why the local Host's Daemon doesn't answer, read from what is on this
 * machine: nothing installed under `~/.polaris`, or an installed Daemon
 * whose own log says why it stopped.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { ConnectFailure } from "./failures.ts";

/**
 * Where `polaris install` puts the Daemon and its service's logs under `home`.
 * On Windows `current` is a directory junction and the binary `polaris.exe`.
 */
export const installedPaths = (home: string, platform: string = process.platform) => ({
  binary: join(
    home,
    ".polaris",
    "bin",
    "current",
    platform === "win32" ? "polaris.exe" : "polaris"
  ),
  errorLog: join(home, ".polaris", "logs", "daemon.err.log"),
  outputLog: join(home, ".polaris", "logs", "daemon.out.log"),
});

const TAIL_BYTES = 4096;

/** The last `count` non-empty lines of a file; none when it is missing or unreadable. */
export const logTail = (path: string, count = 3): ReadonlyArray<string> => {
  let fd: number | null = null;

  try {
    const size = statSync(path).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, "r");
    readSync(fd, buffer, 0, length, size - length);

    return buffer
      .toString("utf8")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "")
      .slice(-count);
  } catch {
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
};

/** The evidence for a Daemon installed in `home` that isn't listening: its log's last words. */
export const daemonLogEvidence = (home: string): ReadonlyArray<string> => {
  const { errorLog, outputLog } = installedPaths(home);
  const errors = logTail(errorLog);

  if (errors.length > 0) return [`${errorLog}:`, ...errors];
  const output = logTail(outputLog, 1);

  return output.length > 0 ? [`${outputLog}:`, ...output] : [`nothing in ${errorLog}`];
};

/**
 * The failure for a refused or missing socket. With `home` (the Daemon is
 * the one installed there), a missing binary is `polaris-not-installed`.
 */
export const localDaemonFailure = (socketPath: string, home?: string): ConnectFailure => {
  if (home !== undefined && !existsSync(installedPaths(home).binary)) {
    return new ConnectFailure({
      kind: "needs-attention",
      reason: "polaris-not-installed",
      detail: `nothing is installed at ${installedPaths(home).binary}`,
    });
  }

  return new ConnectFailure({
    kind: "needs-attention",
    reason: "daemon-not-running",
    detail: [
      `no Daemon is listening on ${socketPath}`,
      ...(home === undefined ? [] : daemonLogEvidence(home)),
    ].join("\n"),
  });
};
