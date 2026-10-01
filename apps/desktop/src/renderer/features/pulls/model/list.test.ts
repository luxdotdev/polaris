import { describe, expect, test } from "bun:test";
import type {
  GitHubAccountsView,
  PullListView,
  PullRowView,
  RepoAccessView,
  WorkspaceRef,
} from "../../../../shared/github.ts";
import { listModel, type ListInput, OTHER_LIMIT, type PlaceInfo } from "./list.ts";
import { noticesOf } from "./notices.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");

const ws = (hostKey: string, workspaceId = "w1"): WorkspaceRef => ({ hostKey, workspaceId });

const row = (id: string, patch: Partial<PullRowView> = {}): PullRowView => ({
  id,
  number: 88,
  title: `Pull ${id}`,
  url: "https://github.com/acme/widgets/pull/88",
  repo: "acme/widgets",
  isDraft: false,
  author: { login: "mchen", avatarUrl: "" },
  headRefName: "mchen/income",
  headRefOid: "abc",
  baseRefName: "main",
  additions: 48,
  deletions: 12,
  updatedAt: "2026-10-01T10:00:00Z",
  reviewDecision: null,
  viewerLatestReview: null,
  requestedReviewers: [],
  accountId: 1,
  workspaces: [ws("linux")],
  ...patch,
});

const list = (patch: Partial<PullListView> = {}): PullListView => ({
  requested: [],
  mine: [],
  other: [],
  repos: [],
  updatedAt: NOW - 60_000,
  polling: "focused",
  throttledUntil: null,
  error: null,
  ...patch,
});

const PLACES = new Map<string, PlaceInfo>(
  Object.entries({
    linux: { workspace: "widgets", hostLabel: "Linux VM", connected: true, state: "connected" },
    studio: { workspace: "widgets", hostLabel: "Mac Studio", connected: true, state: "connected" },
    away: { workspace: "sightline", hostLabel: "Pi", connected: false, state: "reconnecting" },
  })
);

const input = (patch: Partial<ListInput> = {}): ListInput => ({
  list: list(),
  accounts: null,
  accountId: null,
  placeOf: (ref) => PLACES.get(ref.hostKey) ?? null,
  checkouts: new Map(),
  expanded: new Set(),
  now: NOW,
  ...patch,
});

const account = (id: number, login: string) => ({
  id,
  login,
  name: null,
  avatarUrl: "",
  scopes: [],
  missingScopes: [],
  state: "ok" as const,
  signedInAt: null,
  signedOutAt: null,
});

describe("listModel", () => {
  test("groups in order, with the caption Paper R3 shows", () => {
    const model = listModel(
      input({
        list: list({
          requested: [
            row("a"),
            row("b", { repo: "dcai/warehouse", workspaces: [ws("studio"), ws("linux", "w2")] }),
          ],
          mine: [row("c", { isDraft: true })],
          other: [row("d", { workspaces: [] })],
        }),
      })
    );

    expect(model.groups.map((g) => [g.label, g.count])).toEqual([
      ["Review requested", 2],
      ["Mine", 1],
      ["Other open", 1],
    ]);
    expect(model.caption).toBe(
      "4 open in 2 repos · matched to workspaces on 2 hosts · updated 1m ago"
    );

    const [a, b] = model.groups[0]?.rows ?? [];

    expect(a?.meta).toBe("#88 · acme/widgets · mchen");
    expect(a?.workspace).toEqual({ name: "widgets", where: "Linux VM", away: false });
    expect(b?.workspace?.where).toBe("Mac Studio · +1 host");
    expect(model.groups[1]?.rows[0]?.meta).toBe("#88 · acme/widgets · draft · mchen/income");
    expect(model.groups[2]?.rows[0]?.workspace).toBeNull();
    expect(a?.updated).toBe("2h");
    expect(a?.pull).toEqual({ repo: { owner: "acme", name: "widgets" }, number: 88, pullId: "a" });
  });

  test("a Host that isn't connected dims only the workspace lane; a checkout says so", () => {
    const model = listModel(
      input({
        list: list({ other: [row("x", { workspaces: [ws("away")] }), row("y")] }),
        checkouts: new Map([["y", "Linux VM"]]),
      })
    );

    const [x, y] = model.groups[0]?.rows ?? [];

    expect(x?.workspace).toEqual({ name: "sightline", where: "Pi · reconnecting", away: true });
    expect(y?.workspace?.where).toBe("Linux VM · checked out");
  });

  test("other open folds past its limit", () => {
    const other = Array.from({ length: OTHER_LIMIT + 3 }, (_, i) => row(`o${i}`));
    const folded = listModel(input({ list: list({ other }) }));

    expect(folded.groups[0]?.rows).toHaveLength(OTHER_LIMIT);
    expect(folded.groups[0]?.more).toBe(3);
    expect(
      listModel(input({ list: list({ other }), expanded: new Set(["other"]) })).groups[0]?.more
    ).toBe(0);
  });

  test("the account filter and its segments", () => {
    const accounts: GitHubAccountsView = {
      accounts: [account(1, "lucasdoell"), account(2, "lmd-work")],
      signIn: null,
      owners: {},
      workspaces: {},
      storageAvailable: true,
      manageUrl: "",
    };

    const both = list({ requested: [row("a"), row("b", { accountId: 2 })] });

    expect(listModel(input({ list: both, accounts })).accounts.map((a) => a.login)).toEqual([
      "lucasdoell",
      "lmd-work",
    ]);
    expect(listModel(input({ list: both, accounts, accountId: 2 })).total).toBe(1);
    expect(
      listModel(input({ list: both, accounts: { ...accounts, accounts: [account(1, "x")] } }))
        .accounts
    ).toEqual([]);
  });

  test("before the first poll", () => {
    expect(listModel(input({ list: list({ updatedAt: null }) })).caption).toBe(
      "0 open in 0 repos · checking GitHub…"
    );
  });
});

const access = (
  repo: string,
  state: RepoAccessView["state"],
  patch: Partial<RepoAccessView> = {}
): RepoAccessView => ({
  repo,
  state,
  accountId: null,
  login: null,
  permission: null,
  approvalUrl: null,
  ssoUrl: null,
  workspaces: [ws("studio"), ws("studio", "w2")],
  ...patch,
});

describe("noticesOf", () => {
  const hostLabelOf = (ref: WorkspaceRef) => PLACES.get(ref.hostKey)?.hostLabel ?? null;

  test("an owner nobody sees, grouped; a blocked organization repo; dismissals", () => {
    const repos = [
      access("acme-corp/api", "not-found"),
      access("acme-corp/web", "not-found", { workspaces: [] }),
      access("lockedorg/vault", "blocked", {
        approvalUrl: "https://a",
        ssoUrl: "https://s",
        workspaces: [ws("linux")],
      }),
      access("mona/dotfiles", "ok"),
      access("x/y", "no-account"),
    ];

    const notices = noticesOf({ list: list({ repos }), hostLabelOf, dismissed: new Set() });

    expect(notices.map((n) => n.title)).toEqual([
      "lockedorg hasn’t approved Polaris",
      "No GitHub account for acme-corp",
    ]);
    expect(notices[1]?.caption).toBe(
      "2 workspaces on Mac Studio point at it, so its pull requests aren’t listed"
    );
    expect(notices[0]?.caption).toContain(
      "or you sign in with SSO. 1 workspace on Linux VM points at it."
    );

    const dismissed = noticesOf({
      list: list({ repos }),
      hostLabelOf,
      dismissed: new Set(["no-account:acme-corp"]),
    });

    expect(dismissed).toHaveLength(1);
  });

  test("a failed poll", () => {
    const [notice] = noticesOf({
      list: list({ error: "rate limited" }),
      hostLabelOf,
      dismissed: new Set(),
    });

    expect(notice?.kind).toBe("error");
  });
});
