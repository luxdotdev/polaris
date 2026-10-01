import { describe, expect, test } from "bun:test";
import type {
  GitHubAccountView,
  GitHubAccountsView,
  RepoAccessView,
  SignInView,
} from "../../../../shared/github.ts";
import { accountRows, countdown, ownerTable, signInStatus, workspaceOverrides } from "./github.ts";

const account = (id: number, login: string, extra: Partial<GitHubAccountView> = {}) => ({
  id,
  login,
  name: null,
  avatarUrl: "",
  scopes: ["repo", "read:org"],
  missingScopes: [],
  state: "ok" as const,
  signedInAt: null,
  signedOutAt: null,
  ...extra,
});

const view = (extra: Partial<GitHubAccountsView> = {}): GitHubAccountsView => ({
  accounts: [
    account(1, "lucasdoell"),
    account(2, "lmd-work"),
    account(3, "lucas-oss", { state: "signed-out" }),
  ],
  signIn: null,
  owners: { "work-org": 2, "dcai-labs": 2 },
  workspaces: {},
  storageAvailable: true,
  manageUrl: "https://github.com/settings/applications",
  ...extra,
});

const repo = (
  name: string,
  state: RepoAccessView["state"],
  ws: ReadonlyArray<[string, string]>
) => ({
  repo: name,
  state,
  accountId: null,
  login: null,
  permission: null,
  approvalUrl: state === "blocked" ? "https://github.com/orgs/x/policies/applications/1" : null,
  ssoUrl: state === "blocked" ? "https://github.com/orgs/x/sso" : null,
  workspaces: ws.map(([hostKey, workspaceId]) => ({ hostKey, workspaceId })),
});

const labels = (key: string) =>
  ({ local: "Mac Studio", vm: "Linux VM", pi: "Raspberry Pi 4" })[key] ?? key;

const NOW = 1_800_000_000_000;

const DAY = 86_400_000;

describe("GitHub account rows", () => {
  test("the first is the default; each says which owners use it", () => {
    const rows = accountRows(view(), NOW);

    expect(rows.map((r) => [r.login, r.isDefault])).toEqual([
      ["lucasdoell", true],
      ["lmd-work", false],
      ["lucas-oss", false],
    ]);
    expect(rows[0]?.caption).toBe("Used for every owner");
    expect(rows[1]?.caption).toBe("dcai-labs, work-org");
  });

  test("each says when it signed in; a named account leads with its name", () => {
    const rows = accountRows(
      view({ accounts: [account(1, "mona", { name: "Mona Lisa", signedInAt: NOW - 21 * DAY })] }),
      NOW
    );

    expect(rows[0]).toMatchObject({
      since: "signed in 3 weeks ago",
      caption: "Mona Lisa · used for every owner",
    });
  });

  test("a revoked account says when, and needs a new sign-in", () => {
    const [, , revoked] = accountRows(
      view({
        accounts: [
          account(1, "a"),
          account(2, "b"),
          account(3, "c", { state: "signed-out", signedOutAt: NOW - 2 * DAY, signedInAt: 0 }),
        ],
      }),
      NOW
    );

    expect(revoked).toMatchObject({
      since: null,
      caption: "Signed out · GitHub refused its token 2 days ago",
    });
  });

  test("an older revoked account says so and needs a new sign-in", () => {
    const row = accountRows(view(), NOW)[2];

    expect(row?.signedOut).toBe(true);
    expect(row?.caption).toContain("Signed out");
  });

  test("an account without repo access says what it can't see", () => {
    const rows = accountRows(
      view({ accounts: [account(1, "a", { missingScopes: ["repo"] })] }),
      NOW
    );

    expect(rows[0]?.caption).toContain("no repo access");
  });
});

describe("account per owner", () => {
  const pulls = {
    repos: [
      repo("work-org/api", "ok", [
        ["local", "w1"],
        ["vm", "w2"],
      ]),
      repo("work-org/web", "ok", [["local", "w3"]]),
      repo("acme-corp/site", "not-found", [
        ["local", "w4"],
        ["local", "w5"],
      ]),
      repo("lockedorg/vault", "blocked", [["vm", "w6"]]),
      repo("lucasdoell/dotfiles", "ok", [
        ["local", "w7"],
        ["pi", "w8"],
      ]),
    ],
  };

  test("mapped owners and owners in trouble get rows; the rest are everyone else", () => {
    const table = ownerTable(view(), pulls, labels);

    expect(table.rows.map((r) => [r.owner, r.workspaces, r.accountId, r.access.kind])).toEqual([
      ["acme-corp", "2 on Mac Studio", null, "not-found"],
      ["dcai-labs", "No workspaces", 2, "ok"],
      ["lockedorg", "1 on Linux VM", null, "blocked"],
      ["work-org", "3 on 2 hosts", 2, "ok"],
    ]);
    expect(table.everyoneElse).toBe("2 on 2 hosts");
  });

  test("a blocked owner carries its request-access and SSO links", () => {
    const blocked = ownerTable(view(), pulls, labels).rows.find((r) => r.owner === "lockedorg");

    expect(blocked?.access).toMatchObject({ kind: "blocked", repo: "lockedorg/vault" });
  });

  test("before the first poll, only mapped owners show", () => {
    expect(ownerTable(view(), null, labels).rows.map((r) => r.owner)).toEqual([
      "dcai-labs",
      "work-org",
    ]);
  });

  test("a Workspace override names the account its owner would use", () => {
    const overrides = workspaceOverrides(view({ workspaces: { "vm/w2": 1 } }), pulls);

    expect(overrides).toEqual([{ key: "vm/w2", accountId: 1, insteadOf: 2 }]);
  });
});

describe("the device-flow card", () => {
  const flow = (extra: Partial<SignInView> = {}): SignInView => ({
    flowId: "f",
    userCode: "WDJB-MJHT",
    verificationUri: "https://github.com/login/device",
    expiresAt: 900_000,
    state: "waiting",
    failure: null,
    ...extra,
  });

  test("waiting shows the time left", () => {
    expect(signInStatus(flow(), 900_000 - 872_000)).toEqual({
      waiting: true,
      text: "Waiting for GitHub",
      aside: "code expires in 14:32",
    });
  });

  test("failures and expiry say why", () => {
    expect(signInStatus(flow({ state: "failed", failure: "denied" }), 0).text).toContain(
      "declined"
    );
    expect(signInStatus(flow(), 1_000_000).text).toContain("expired");
    expect(countdown(0, 5_000)).toBe("0:00");
  });
});
