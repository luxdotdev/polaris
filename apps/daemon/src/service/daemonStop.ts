/**
 * Why the last Daemon stopped, when it was asked to stop so another could take
 * over (a Windows upgrade, ADR 0060). The stopping Daemon writes it; the next
 * one takes it once and reports it as `HostInfo.previousStop`, so a Client can
 * say its terminals ended for an upgrade. A crash leaves none.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DaemonStop } from "@polaris/protocol";
import { Option, Schema } from "effect";

const recordPath = (root: string) => join(root, "daemon-stop.json");

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(DaemonStop));

/** Records that this Daemon (`fromVersion`) is stopping for `reason`. */
export const writeStopRecord = (root: string, reason: string, fromVersion: string): void => {
  const record = DaemonStop.make({ reason, fromVersion, at: new Date().toISOString() });
  const temp = `${recordPath(root)}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(Schema.encodeSync(DaemonStop)(record)), { mode: 0o600 });
  renameSync(temp, recordPath(root));
};

/** The record the previous Daemon left, removed so a later restart doesn't repeat it. */
export const takeStopRecord = (root: string): DaemonStop | null => {
  let text: string;

  try {
    text = readFileSync(recordPath(root), "utf8");
  } catch {
    return null;
  }

  rmSync(recordPath(root), { force: true });

  return Option.getOrNull(decode(text));
};
