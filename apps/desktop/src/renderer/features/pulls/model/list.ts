/**
 * The pull request list as Review shows it (Paper R3, DESIGN.md Review → Pull requests):
 * groups, fixed lanes, the header caption and the account filter. Pure, so it is tested;
 * the notices above the list are in `notices.ts`.
 */
import type { OpenPull } from "../../../../shared/api.ts";
import type {
  GitHubAccountsView,
  PullListView,
  PullRowView,
  WorkspaceRef,
} from "../../../../shared/github.ts";
import { age, plural } from "../../../shell/copy.ts";

export type GroupId = "requested" | "mine" | "other";

/** Where a Workspace lives, as the list needs it. */
export interface PlaceInfo {
  /** The Workspace's name; null when the Host hasn't said (yet). */
  readonly workspace: string | null;
  readonly hostLabel: string;
  readonly connected: boolean;
  /** "reconnecting", "offline"…: shown when the Host isn't connected. */
  readonly state: string;
}

export type PlaceOf = (ref: WorkspaceRef) => PlaceInfo | null;

export interface WorkspaceLane {
  readonly name: string;
  /** "Linux VM · checked out", "Mac Studio · +1 host", "Linux VM · reconnecting". */
  readonly where: string;
  /** The Host isn't connected: only this lane dims; the pull request comes from GitHub. */
  readonly away: boolean;
}

export interface RowModel {
  readonly id: string;
  readonly pull: OpenPull;
  readonly title: string;
  readonly meta: string;
  /** Null for a repository no Workspace points at. */
  readonly workspace: WorkspaceLane | null;
  readonly additions: number;
  readonly deletions: number;
  readonly updated: string;
}

export interface GroupModel {
  readonly id: GroupId;
  readonly label: string;
  readonly count: number;
  readonly rows: ReadonlyArray<RowModel>;
  /** Rows behind "Show N more". */
  readonly more: number;
}

export interface AccountSegment {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string;
}

export interface ListModel {
  readonly caption: string;
  /** Shown only with two or more accounts. */
  readonly accounts: ReadonlyArray<AccountSegment>;
  readonly groups: ReadonlyArray<GroupModel>;
  readonly total: number;
}

export interface ListInput {
  readonly list: PullListView;
  readonly accounts: GitHubAccountsView | null;
  /** Null for all accounts. */
  readonly accountId: number | null;
  readonly placeOf: PlaceOf;
  /** Pull request node id → the Host label of its Review Checkout, when one exists. */
  readonly checkouts: ReadonlyMap<string, string>;
  /** Groups the user expanded past their first rows. */
  readonly expanded: ReadonlySet<GroupId>;
  readonly now: number;
}

/** "Other open" shows this many until expanded; the other groups show everything. */
export const OTHER_LIMIT = 8;

const LABELS: Readonly<Record<GroupId, string>> = {
  requested: "Review requested",
  mine: "Mine",
  other: "Other open",
};

const repoRef = (row: PullRowView) => {
  const [owner = "", name = ""] = row.repo.split("/");

  return { owner, name };
};

const metaOf = (row: PullRowView, group: GroupId) => {
  const who = group === "mine" ? row.headRefName : (row.author?.login ?? null);

  return [`#${row.number}`, row.repo, row.isDraft ? "draft" : null, who]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
};

const laneOf = (row: PullRowView, placeOf: PlaceOf, checkout: string | undefined) => {
  const places = row.workspaces.flatMap((ref) => {
    const place = placeOf(ref);

    return place === null ? [] : [place];
  });

  const primary = places.find((p) => p.connected) ?? places[0];

  if (primary === undefined) return null;

  const hosts = new Set(places.map((p) => p.hostLabel)).size;
  const others = hosts > 1 ? `+${plural(hosts - 1, "host")}` : null;
  const detail = checkout === undefined ? others : "checked out";
  const status = primary.connected ? detail : primary.state;

  return {
    name: primary.workspace ?? repoRef(row).name,
    where: [checkout ?? primary.hostLabel, status].filter((p) => p !== null).join(" · "),
    away: !primary.connected,
  };
};

const rowOf = (row: PullRowView, group: GroupId, input: ListInput): RowModel => ({
  id: row.id,
  pull: { repo: repoRef(row), number: row.number, pullId: row.id },
  title: row.title,
  meta: metaOf(row, group),
  workspace: laneOf(row, input.placeOf, input.checkouts.get(row.id)),
  additions: row.additions,
  deletions: row.deletions,
  updated: age(row.updatedAt, input.now),
});

const captionOf = (rows: ReadonlyArray<PullRowView>, input: ListInput) => {
  const repos = new Set(rows.map((r) => r.repo.toLowerCase())).size;

  const hosts = new Set(
    rows.flatMap((r) => r.workspaces.flatMap((w) => input.placeOf(w)?.hostLabel ?? []))
  ).size;

  const updatedAt = input.list.updatedAt;

  return [
    `${rows.length} open in ${plural(repos, "repo")}`,
    hosts === 0 ? null : `matched to workspaces on ${plural(hosts, "host")}`,
    updatedAt === null ? "checking GitHub…" : `updated ${updatedText(updatedAt, input.now)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

const updatedText = (at: number, now: number) => {
  const text = age(new Date(at).toISOString(), now);

  return text === "now" ? "just now" : `${text} ago`;
};

export const listModel = (input: ListInput): ListModel => {
  const pick = (rows: ReadonlyArray<PullRowView>) =>
    input.accountId === null ? rows : rows.filter((r) => r.accountId === input.accountId);

  const ids: ReadonlyArray<GroupId> = ["requested", "mine", "other"];
  const all = ids.flatMap((id) => pick(input.list[id]));

  const groups = ids.flatMap((id): ReadonlyArray<GroupModel> => {
    const rows = pick(input.list[id]);

    if (rows.length === 0) return [];

    const limit = id === "other" && !input.expanded.has(id) ? OTHER_LIMIT : rows.length;

    return [
      {
        id,
        label: LABELS[id],
        count: rows.length,
        rows: rows.slice(0, limit).map((r) => rowOf(r, id, input)),
        more: Math.max(0, rows.length - limit),
      },
    ];
  });

  const signedIn = (input.accounts?.accounts ?? []).filter((a) => a.state === "ok");

  return {
    caption: captionOf(all, input),
    accounts:
      signedIn.length < 2
        ? []
        : signedIn.map((a) => ({ id: a.id, login: a.login, avatarUrl: a.avatarUrl })),
    groups,
    total: all.length,
  };
};
