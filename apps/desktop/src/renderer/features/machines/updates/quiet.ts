/** Quiet Upgrade notes: one hour in the machine bar, one day in Hosts. */
import { DAEMON_STOP_UPGRADE, type DaemonStop } from "@polaris/protocol";
import type { DaemonUpdateResult } from "../../../../shared/daemonUpdates.ts";
import { clientCopy } from "../../../../shared/clientCopy.ts";

export const UPGRADE_CAPTION_MS = 60 * 60 * 1000;

const HOVER_MS = 24 * UPGRADE_CAPTION_MS;

export const upgradeCaption = (
  last: DaemonUpdateResult | null,
  openedAt: number | undefined,
  now: number
): string | null => {
  if (
    last?.result !== "updated" ||
    last.version === null ||
    now - last.at >= UPGRADE_CAPTION_MS ||
    (openedAt !== undefined && openedAt >= last.at)
  )
    return null;

  return `Upgraded to ${last.version}`;
};

const ago = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);

  if (minutes < 1) return "just now";

  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};

export interface QuietNote {
  readonly title: string;
  readonly body: string;
}

export const upgradeHover = (last: DaemonUpdateResult | null, now: number): QuietNote | null => {
  if (last?.result !== "updated" || last.version === null || now - last.at >= HOVER_MS) return null;

  return {
    title: `Daemon upgraded to ${last.version} · ${ago(now - last.at)}`,
    body: `${last.from === null ? "Upgraded" : `From ${last.from}`}, to match ${clientCopy().machine}. Agent sessions kept working.`,
  };
};

/** The Daemon replaced one that stopped on purpose (ADR 0060): its `hello` says so, once. */
export interface StoppedDaemon {
  readonly stop: DaemonStop;
  /** The version running now. */
  readonly version: string;
}

const stopAt = (stop: DaemonStop) => Date.parse(stop.at);

const upgraded = (stop: DaemonStop) => stop.reason === DAEMON_STOP_UPGRADE;

/** "Upgraded to 0.2.1" or "Daemon restarted" in the machine bar, until the Host opens. */
export const stopCaption = (
  stopped: StoppedDaemon | null,
  seenAt: string | undefined,
  now: number
): string | null => {
  if (stopped === null || seenAt === stopped.stop.at) return null;

  if (!(now - stopAt(stopped.stop) < UPGRADE_CAPTION_MS)) return null;

  return upgraded(stopped.stop) ? `Upgraded to ${stopped.version}` : "Daemon restarted";
};

/** The hover that says what the stop cost: the Host's terminals ended, sessions recovered. */
export const stopHover = (stopped: StoppedDaemon | null, now: number): QuietNote | null => {
  if (stopped === null) return null;
  const since = now - stopAt(stopped.stop);

  if (!(since < HOVER_MS)) return null;

  return upgraded(stopped.stop)
    ? {
        title: `Daemon upgraded to ${stopped.version} · ${ago(since)}`,
        body: `From ${stopped.stop.fromVersion}. Its terminals ended with the old daemon; agent sessions recovered.`,
      }
    : {
        title: `Daemon restarted · ${ago(since)}`,
        body: `The daemon (${stopped.stop.fromVersion}) stopped and started again. Its terminals ended; agent sessions recovered.`,
      };
};
