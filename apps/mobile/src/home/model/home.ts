/**
 * Home (Paper H4) as data: the summary, the workspace chips and the sections ranked needs you,
 * working, recent, built from every Host's followed feed. Pure, so every state is testable.
 */
import type { ApprovalRequest, ConnectionState } from "@polaris/protocol";
import type { FollowedHost } from "../feed/follow.ts";
import type { ConstellationListing, Session, SessionEntry } from "../feed/fold.ts";
import { counted, harnessName } from "./format.ts";

export interface HomeHost {
  readonly hostId: string;
  readonly name: string;
  readonly connection: ConnectionState;
  readonly followed: FollowedHost;
}

export interface SessionRow {
  readonly kind: "session";
  readonly key: string;
  readonly hostId: string;
  readonly hostName: string;
  readonly workspaceName: string;
  readonly session: Session;
  /** The approval or question shown inline; null when nothing is pending. */
  readonly approval: ApprovalRequest | null;
  readonly replyPreview: string | null;
  /** When the row's age counts from (ms since epoch). */
  readonly since: number;
  /** The Host isn't connected: the row is as last seen and can't be acted on. */
  readonly stale: boolean;
}

export interface ConstellationRow {
  readonly kind: "constellation";
  readonly key: string;
  readonly hostId: string;
  readonly hostName: string;
  readonly constellation: ConstellationListing;
  readonly lead: Session | null;
  readonly since: number;
  readonly stale: boolean;
}

export type HomeRow = SessionRow | ConstellationRow;

export interface WorkspaceChip {
  /** Null for "All workspaces". */
  readonly name: string | null;
  readonly label: string;
}

export type HomeEmpty =
  /** No Host is known yet: link this iPhone. */
  | "no-hosts"
  /** A Host is connected and its first snapshot hasn't arrived yet. */
  | "loading"
  /** Hosts are known but none has been reached this launch. */
  | "unreachable"
  /** Reached, with no agent sessions at all. */
  | "no-sessions"
  /** Agent sessions exist, none in the chosen workspace. */
  | "filtered";

export interface Home {
  readonly hostCount: number;
  readonly needsYou: number;
  readonly working: number;
  /** A Host that isn't connected, named ("Linux VM reconnecting"), or a count of them. */
  readonly attention: string | null;
  readonly workspaceCount: number;
  readonly chips: ReadonlyArray<WorkspaceChip>;
  readonly sections: {
    readonly needsYou: ReadonlyArray<SessionRow>;
    readonly working: ReadonlyArray<HomeRow>;
    readonly recent: ReadonlyArray<HomeRow>;
  };
  readonly empty: HomeEmpty | null;
}

/** Recent stops here; older agent sessions stay on the Desktop App's list. */
export const RECENT_LIMIT = 30;

const WORKING: ReadonlySet<Session["state"]> = new Set(["starting", "working"]);

const ACTIVE_CONSTELLATION: ReadonlySet<ConstellationListing["state"]> = new Set([
  "planning",
  "running",
  "paused",
]);

const stateWord: Record<Exclude<ConnectionState, "connected">, string> = {
  reconnecting: "reconnecting",
  "needs-attention": "needs attention",
  offline: "offline",
};

const attentionLine = (hosts: ReadonlyArray<HomeHost>): string | null => {
  const words = hosts.flatMap((host) =>
    host.connection === "connected" ? [] : [{ name: host.name, word: stateWord[host.connection] }]
  );

  const [first] = words;

  if (first === undefined) return null;

  if (words.length === 1) return `${first.name} ${first.word}`;

  if (words.length === hosts.length && words.every(({ word }) => word === first.word))
    return `All hosts ${first.word}`;

  return `${counted(words.length, "host")} not connected`;
};

const isListed = (session: Session) => session.state !== "archived" && session.origin == null;

interface Placed {
  readonly host: HomeHost;
  readonly entry: SessionEntry;
  readonly workspaceName: string;
}

const placedSessions = (hosts: ReadonlyArray<HomeHost>): ReadonlyArray<Placed> =>
  hosts.flatMap((host) =>
    [...host.followed.state.sessions.values()].flatMap((entry) =>
      isListed(entry.session)
        ? [
            {
              host,
              entry,
              workspaceName:
                host.followed.state.workspaces.get(entry.session.workspaceId)?.name ?? "",
            },
          ]
        : []
    )
  );

const sessionRow = ({ host, entry, workspaceName }: Placed): SessionRow => {
  const approval = entry.pendingApprovals[0] ?? null;

  return {
    kind: "session",
    key: `${host.hostId}/${entry.session.id}`,
    hostId: host.hostId,
    hostName: host.name,
    workspaceName,
    session: entry.session,
    approval,
    replyPreview: entry.replyPreview,
    since: Date.parse(approval?.openedAt ?? entry.session.updatedAt),
    stale: host.connection !== "connected",
  };
};

const needsYou = (placed: Placed) =>
  placed.entry.pendingApprovals.length > 0 || placed.entry.session.state === "needs-you";

const constellationRows = (
  hosts: ReadonlyArray<HomeHost>,
  inWorkspace: (host: HomeHost, workspaceId: string) => boolean
): ReadonlyArray<ConstellationRow> =>
  hosts.flatMap((host) =>
    [...host.followed.state.constellations.values()].flatMap((constellation) => {
      if (constellation.state === "archived" || !inWorkspace(host, constellation.workspaceId))
        return [];
      const lead = host.followed.state.sessions.get(constellation.leadSessionId)?.session ?? null;

      return [
        {
          kind: "constellation" as const,
          key: `${host.hostId}/constellation/${constellation.id}`,
          hostId: host.hostId,
          hostName: host.name,
          constellation,
          lead,
          since: Date.parse(lead?.updatedAt ?? constellation.createdAt),
          stale: host.connection !== "connected",
        },
      ];
    })
  );

const newestFirst = (a: HomeRow, b: HomeRow) => b.since - a.since;

const chipsOf = (hosts: ReadonlyArray<HomeHost>, placed: ReadonlyArray<Placed>) => {
  const latest = new Map<string, number>();

  for (const host of hosts)
    for (const workspace of host.followed.state.workspaces.values())
      if (!workspace.hidden && !latest.has(workspace.name)) latest.set(workspace.name, 0);

  for (const { workspaceName, entry } of placed) {
    const at = Date.parse(entry.session.updatedAt);

    if (workspaceName !== "" && at > (latest.get(workspaceName) ?? 0))
      latest.set(workspaceName, at);
  }

  const names = [...latest.entries()]
    .sort(([a, at], [b, bt]) => bt - at || a.localeCompare(b))
    .map(([name]) => name);

  return names;
};

const emptyOf = (
  hosts: ReadonlyArray<HomeHost>,
  listed: number,
  shown: number
): HomeEmpty | null => {
  if (hosts.length === 0) return "no-hosts";

  if (shown > 0) return null;

  if (listed > 0) return "filtered";

  if (!hosts.some((host) => host.followed.seen))
    return hosts.some((host) => host.connection === "connected") ? "loading" : "unreachable";

  return "no-sessions";
};

export const buildHome = (hosts: ReadonlyArray<HomeHost>, workspace: string | null): Home => {
  const placed = placedSessions(hosts);
  const shown = placed.filter((p) => workspace === null || p.workspaceName === workspace);

  const inWorkspace = (host: HomeHost, workspaceId: string) =>
    workspace === null || host.followed.state.workspaces.get(workspaceId)?.name === workspace;

  const constellations = constellationRows(hosts, inWorkspace);

  const leads = new Set(
    constellations.map((row) => `${row.hostId}/${row.constellation.leadSessionId}`)
  );

  const isLead = (p: Placed) => leads.has(`${p.host.hostId}/${p.entry.session.id}`);

  const needing = shown.filter(needsYou).map(sessionRow);
  const rest = shown.filter((p) => !needsYou(p) && !isLead(p));

  const working = [
    ...constellations.filter((row) => ACTIVE_CONSTELLATION.has(row.constellation.state)),
    ...rest.filter((p) => WORKING.has(p.entry.session.state)).map(sessionRow),
  ].sort(newestFirst);

  const recent = [
    ...constellations.filter((row) => !ACTIVE_CONSTELLATION.has(row.constellation.state)),
    ...rest.filter((p) => !WORKING.has(p.entry.session.state)).map(sessionRow),
  ]
    .sort(newestFirst)
    .slice(0, RECENT_LIMIT);

  const names = chipsOf(hosts, placed);

  return {
    hostCount: hosts.length,
    needsYou: placed.filter(needsYou).length,
    working: placed.filter((p) => !needsYou(p) && WORKING.has(p.entry.session.state)).length,
    attention: attentionLine(hosts),
    workspaceCount: names.length,
    chips: [
      { name: null, label: "All workspaces" },
      ...names.map((name) => ({ name, label: name })),
    ],
    sections: {
      needsYou: needing.sort((a, b) => a.since - b.since),
      working,
      recent,
    },
    empty: emptyOf(hosts, placed.length, needing.length + working.length + recent.length),
  };
};

/** "Codex · Mac Studio · polaris": who, where, which workspace. */
export const whereLine = (row: SessionRow): string =>
  [harnessName(row.session.harness), row.hostName, row.workspaceName]
    .filter((part) => part !== "")
    .join(" · ");
