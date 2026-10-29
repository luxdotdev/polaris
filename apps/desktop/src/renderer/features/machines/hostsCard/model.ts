/**
 * The Hosts card as data (DESIGN.md, Menus and popovers; Paper X-F 05): each Host's picture
 * and state words, and the footer's status line. Pure, so it is tested.
 */
import { Match } from "effect";
import type { HostKind, HostView } from "../../../../shared/api.ts";

/** Which machine the hero draws: only what the Host's kind and platform say. */
export type HostArt = "mac" | "server" | "virtual" | "board";

/** A WSL distro is virtual; a Mac is a Mac; a Linux arm64 Host is drawn as a board. */
export const hostArt = (kind: HostKind, platform: string | undefined): HostArt => {
  if (kind === "wsl") return "virtual";

  if (platform?.startsWith("darwin") === true) return "mac";

  return platform === "linux-arm64" ? "board" : "server";
};

/** The kicker under a Host's name ("reconnecting · 12s"), set in mono caps. */
export const stateParts = (
  host: HostView,
  since: string | undefined,
  slow: boolean
): ReadonlyArray<string> =>
  Match.value(host.status.state).pipe(
    Match.when("connected", () =>
      slow && host.status.latencyMs !== null
        ? ["slow link", `${host.status.latencyMs}ms`]
        : ["connected"]
    ),
    Match.when("reconnecting", () =>
      since === undefined ? ["reconnecting"] : ["reconnecting", since]
    ),
    Match.when("offline", () =>
      since === undefined ? ["offline"] : ["offline", `since ${since}`]
    ),
    Match.when("needs-attention", () => ["needs attention"]),
    Match.exhaustive
  );

/** The footer's words for the Hosts that aren't connected, worst first. */
const TROUBLE = [
  ["needs-attention", "needs attention"],
  ["reconnecting", "retrying"],
  ["offline", "offline"],
] as const;

/** "2 of 3 connected · Raspberry Pi 4 retrying": one Host is named, several are counted. */
export const statusLine = (hosts: ReadonlyArray<HostView>): string => {
  const total = hosts.length;

  if (total === 0) return "no hosts";
  const connected = hosts.filter((h) => h.status.state === "connected").length;

  if (connected === total) return total === 1 ? "connected" : `all ${total} connected`;

  const trouble = TROUBLE.flatMap(([state, words]) => {
    const these = hosts.filter((h) => h.status.state === state);

    if (these.length === 0) return [];

    return [`${these.length === 1 ? these[0]?.label : these.length} ${words}`];
  });

  return [`${connected} of ${total} connected`, ...trouble].join(" · ");
};

/** How the remote Hosts are reached, for the label on their shared line ("ssh · wsl"). */
export const routeWords = (hosts: ReadonlyArray<HostView>): ReadonlyArray<string> => {
  const kinds = new Set(hosts.map((h) => h.kind));

  return [kinds.has("ssh") ? "ssh" : null, kinds.has("wsl") ? "wsl" : null].filter(
    (w): w is string => w !== null
  );
};

/** Most Hosts side by side in the hero before it starts a new row. */
export const PER_ROW = 4;

/** The remote Hosts in rows of at most `PER_ROW`, for the hero. */
export const rowsOf = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / PER_ROW) }, (_, row) =>
    items.slice(row * PER_ROW, (row + 1) * PER_ROW)
  );
