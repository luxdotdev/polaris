/**
 * Hosts (Paper M7) as data: each Host's Connection State, route and agent session count, read
 * only. Routes are chosen on the Mac (Remote Access), never here.
 */
import type { ConnectionState } from "@polaris/protocol";
import { Match } from "effect";
import type { HostRoute } from "../runtime/hostConnection.ts";
import { age, counted } from "../home/model/format.ts";

export interface HostInput {
  readonly hostId: string;
  readonly name: string;
  readonly route: HostRoute;
  readonly state: ConnectionState;
  /** The failure's own line, for Needs Attention. */
  readonly failure: string | null;
  readonly latencyMs: number | null;
  /** When the last good connection ended (ms since epoch); null while connected or never. */
  readonly lastSeenAt: number | null;
  /** Listed agent sessions as last seen; null when never seen this launch. */
  readonly sessions: number | null;
}

export interface HostRowModel {
  readonly key: string;
  readonly name: string;
  readonly state: ConnectionState;
  readonly line: string;
  readonly count: string;
  readonly countLabel: string;
  /** Reconnecting dims the row; Offline greys its text instead (M7). */
  readonly dimmed: boolean;
}

export interface HostsModel {
  readonly summary: ReadonlyArray<{ readonly text: string; readonly emphasis: boolean }>;
  readonly rows: ReadonlyArray<HostRowModel>;
}

export const routeLabel = (route: HostRoute): string =>
  Match.value(route).pipe(
    Match.when("relay", () => "via Polaris Relay"),
    Match.when("dev-bridge", () => "on this network"),
    Match.exhaustive
  );

const join = (...parts: ReadonlyArray<string | null>) =>
  parts.filter((part): part is string => part !== null).join(" · ");

const stateLine = (host: HostInput, now: number): string =>
  Match.value(host.state).pipe(
    Match.when("connected", () =>
      join(
        "Connected",
        host.latencyMs === null ? null : `${Math.round(host.latencyMs)} ms`,
        routeLabel(host.route)
      )
    ),
    Match.when("reconnecting", () =>
      join(
        "Reconnecting",
        host.lastSeenAt === null ? null : elapsed(host.lastSeenAt, now),
        routeLabel(host.route)
      )
    ),
    Match.when("needs-attention", () => join("Needs attention", host.failure)),
    Match.when("offline", () =>
      host.lastSeenAt === null ? "Offline" : `Offline · last seen ${age(host.lastSeenAt, now)} ago`
    ),
    Match.exhaustive
  );

/** "42s", "3m": how long a Host has been reconnecting. */
const elapsed = (since: number, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));

  return seconds < 60 ? `${seconds}s` : age(since, now);
};

const countOf = (host: HostInput) => {
  const sessions = host.sessions ?? 0;
  const label = sessions === 1 ? "agent session" : "agent sessions";

  return {
    count: String(sessions),
    countLabel: host.state !== "connected" && host.sessions !== null ? "last known" : label,
  };
};

const ORDER: Record<ConnectionState, number> = {
  "needs-attention": 0,
  connected: 1,
  reconnecting: 2,
  offline: 3,
};

export const buildHosts = (hosts: ReadonlyArray<HostInput>, now: number): HostsModel => {
  const rows = [...hosts]
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name))
    .map((host) => ({
      key: host.hostId,
      name: host.name,
      state: host.state,
      line: stateLine(host, now),
      ...countOf(host),
      dimmed: host.state === "reconnecting",
    }));

  const tally = (state: ConnectionState) => hosts.filter((host) => host.state === state).length;

  const summary = (["connected", "needs-attention", "reconnecting", "offline"] as const).flatMap(
    (state) => {
      const count = tally(state);

      return count === 0
        ? []
        : [
            {
              text: `${count} ${state === "needs-attention" ? "needs attention" : state}`,
              emphasis: state === "needs-attention" || state === "reconnecting",
            },
          ];
    }
  );

  return {
    summary: hosts.length === 0 ? [{ text: counted(0, "host"), emphasis: false }] : summary,
    rows,
  };
};

/** What to say when Unlink left this iPhone trusted somewhere (RX1-3); null when it didn't. */
export const unlinkNote = (kept: ReadonlyArray<string>): string | null => {
  if (kept.length === 0) return null;
  const one = kept.length === 1;

  return `Still linked to ${kept.join(", ")}: ${one ? "it" : "they"} didn't answer. Unlink again when ${one ? "it's" : "they're"} online, or unlink this iPhone on your Mac in Settings → Devices.`;
};
