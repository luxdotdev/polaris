/**
 * The title bar's offline indicator as data (DESIGN.md, Titlebar; Paper 9, 9b): shown when
 * this Mac has no network, or every remote Host is unreachable, with one row per remote
 * Host that isn't connected. Pure, so it is tested; the Connection State machine is untouched.
 */
import { clientCopy } from "../../shared/clientCopy.ts";
import type { HostView } from "../../shared/api.ts";

const SECOND = 1000;

/** "23s", "4m", "2h": a Connection State chip's elapsed time. */
export const elapsedLabel = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / SECOND));

  if (seconds < 60) return `${seconds}s`;

  return seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
};

/** "09:14": when a Host went offline. */
export const clockLabel = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** "23s", "2m 14s", "1h 5m": how long this Mac has been cut off. */
export const durationLabel = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / SECOND));

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export type UnreachableState = "reconnecting" | "offline" | "needs-attention";

export interface OfflineRow {
  readonly key: string;
  readonly label: string;
  readonly state: UnreachableState;
  /** "Reconnecting… (23s) · next try in 8s", "Offline since 09:02 · next try in 6m". */
  readonly caption: string;
}

export interface OfflineView {
  /** No network on this Mac, or the network is up and every remote Host is unreachable. */
  readonly reason: "network" | "hosts";
  readonly title: string;
  readonly caption: string;
  readonly rows: ReadonlyArray<OfflineRow>;
}

export interface OfflineInput {
  readonly hosts: ReadonlyArray<HostView>;
  /** What the OS says (`navigator.onLine`). */
  readonly online: boolean;
  /** When the OS last went offline; null while online. */
  readonly offlineSince: number | null;
  readonly now: number;
}

/** The local Host's key in the HostRegistry (main/hosts.ts). */
const LOCAL = "local";

const nextTry = (host: HostView, now: number) => {
  const at = host.status.nextAttemptAt;

  return at === null ? "" : ` · next try in ${elapsedLabel(Math.max(0, at - now))}`;
};

const rowOf = (host: HostView, now: number): OfflineRow | null => {
  const { state, since } = host.status;

  if (state === "connected") return null;
  const base = { key: host.key, label: host.label, state };

  if (state === "needs-attention") return { ...base, caption: "Needs attention" };

  if (state === "offline")
    return { ...base, caption: `Offline since ${clockLabel(since)}${nextTry(host, now)}` };

  return {
    ...base,
    caption: `Reconnecting… (${elapsedLabel(now - since)})${nextTry(host, now)}`,
  };
};

export const offlineView = ({ hosts, online, offlineSince, now }: OfflineInput) => {
  const remote = hosts.filter((h) => h.key !== LOCAL);
  const rows = remote.flatMap((h) => rowOf(h, now) ?? []);
  const hostsDown = remote.length > 0 && rows.length === remote.length;

  if (online && !hostsDown) return null;

  // The network's own time when it is the cause; else since the last Host dropped.
  const since = online ? Math.max(...remote.map((h) => h.status.since)) : (offlineSince ?? now);
  const what = online ? "Can't reach your other hosts" : `No network on ${clientCopy().machine}`;

  const view: OfflineView = {
    reason: online ? "hosts" : "network",
    title: `${what} · ${durationLabel(now - since)}`,
    caption:
      remote.length === 0
        ? `Agent sessions on ${clientCopy().machine} keep working.`
        : "Agent sessions on other hosts keep working there. Polaris keeps retrying on its own.",
    rows,
  };

  return view;
};
