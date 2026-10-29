/**
 * The needs you inbox (Paper MX-H) as data: every Host's needs you rows in Home's order, so the
 * sheet and Home's hero card never disagree. Derived from the feeds, so a resolved request leaves it.
 */
import type { ConnectionState } from "@polaris/protocol";
import { counted } from "../home/model/format.ts";
import { buildHome, type HomeHost, type SessionRow } from "../home/model/home.ts";

export interface FooterHost {
  readonly hostId: string;
  /** "mac-studio", "lucas-rpi reconnecting". */
  readonly label: string;
  readonly connection: ConnectionState;
}

export interface Inbox {
  /** Oldest first across every Host, as on Home. */
  readonly items: ReadonlyArray<SessionRow>;
  readonly count: number;
  /** The empty state's second line ("4 sessions working on 2 hosts"); null when nothing works. */
  readonly working: string | null;
  readonly hosts: ReadonlyArray<FooterHost>;
  /** Shown while a Host is away: its rows can't be answered until it's back. */
  readonly away: boolean;
}

const stateWord: Record<ConnectionState, string> = {
  connected: "",
  reconnecting: " reconnecting",
  "needs-attention": " needs attention",
  offline: " offline",
};

const workingLine = (home: ReturnType<typeof buildHome>, hostCount: number) =>
  home.working === 0
    ? null
    : `${counted(home.working, "session")} working on ${counted(hostCount, "host")}`;

export const inboxOf = (hosts: ReadonlyArray<HomeHost>): Inbox => {
  const home = buildHome(hosts, null);
  const items = home.sections.needsYou;
  const busyHosts = new Set(home.sections.working.map((row) => row.hostId));

  return {
    items,
    count: items.length,
    working: workingLine(home, Math.max(busyHosts.size, 1)),
    hosts: hosts.map((host) => ({
      hostId: host.hostId,
      label: `${host.name}${stateWord[host.connection]}`,
      connection: host.connection,
    })),
    away: hosts.some((host) => host.connection !== "connected"),
  };
};
