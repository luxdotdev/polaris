/**
 * Fixtures for the pull request preview, after Paper R3 (7LH-0): review requested, mine and
 * other open across three Hosts (one reconnecting), two accounts, and a repository nobody
 * sees, so screenshots compare on content too.
 */
import {
  AgentSession,
  ReviewCheckout,
  ReviewCheckoutId,
  type ReviewSubject,
  SessionId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Data } from "effect";
import type { HostView } from "../../../../shared/api.ts";
import type {
  GitHubAccountsView,
  PullListView,
  PullRowView,
  WorkspaceRef,
} from "../../../../shared/github.ts";
import { emptyHostModel, type HostModel, type SessionEntry } from "../../../store/hostModel.ts";
import { HOSTS as NEEDS_YOU_HOSTS } from "../../needs-you/preview/fixtures.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const host = (key: string, label: string, state: HostView["status"]["state"] = "connected") => {
  const base = NEEDS_YOU_HOSTS[0];

  if (base === undefined) throw new Error("needs-you fixtures have no Host");

  return { ...base, key, label, alias: key, status: { ...base.status, state } };
};

export const HOSTS: ReadonlyArray<HostView> = [
  host("local", "MacBook Pro"),
  host("studio", "Mac Studio"),
  host("linux-vm", "Linux VM", "reconnecting"),
];

const workspace = (id: string, name: string) =>
  new Workspace({
    id: WorkspaceId.make(id),
    path: `/Users/lucas/code/${name}`,
    name,
    isGitRepo: true,
    worktreeRoot: `/Users/lucas/code/${name}.worktrees`,
    hidden: false,
    registeredAt: ago(60 * 24 * 30),
  });

const model = (
  workspaces: ReadonlyArray<Workspace>,
  extra: Partial<Pick<HostModel, "sessions" | "reviewCheckouts">> = {}
): HostModel => ({
  ...emptyHostModel,
  synchronized: true,
  workspaces: new Map(workspaces.map((w) => [w.id, w])),
  ...extra,
});

/** R3's "Agent sessions ready": Turns 22–24 of a Claude Code session, not yet accepted. */
const orchestrator = new AgentSession({
  id: SessionId.make("s-orchestrator"),
  workspaceId: WorkspaceId.make("w-polaris"),
  harness: "claude",
  title: "Orchestrator layout prototype",
  cwd: "/Users/lucas/code/polaris",
  worktreeId: null,
  state: "idle",
  permissionMode: "supervised",
  model: null,
  effort: null,
  parentSessionId: null,
  forkedFromTurnId: null,
  harnessCursor: null,
  turnCount: 24,
  contextUsage: null,
  lastError: null,
  acceptedThroughIndex: 20,
  createdAt: ago(600),
  updatedAt: ago(12),
});

const entry: SessionEntry = {
  session: orchestrator,
  pendingApprovals: [],
  lastTurnPreview: null,
  subagents: [],
};

/** #88's Review Checkout on the Mac Studio ("checked out"), its summary cached at `h88`. */
const checkout88 = new ReviewCheckout({
  id: ReviewCheckoutId.make("c-88"),
  workspaceId: WorkspaceId.make("w-nj"),
  subject: Data.taggedEnum<ReviewSubject>().PullRequest({
    pullRequest: {
      repo: { host: "github.com", owner: "work-org", name: "nj-homes-choice-next" },
      number: 88,
    },
    baseRef: "main",
  }),
  path: "/Users/lucas/code/nj-homes.worktrees/.review/pr-88",
  state: "ready",
  blocked: null,
  head: "h88",
  mergeBase: "b88",
  latestHead: "h88",
  latestBase: "b88",
  reviewedHead: "h88",
  reviewedMergeBase: "b88",
  openedAt: ago(200),
  updatedAt: ago(100),
});

export const ORCHESTRATOR_KEY = `session:studio:${orchestrator.id}`;

export const MODELS = {
  local: model([workspace("w-polaris", "polaris")]),
  studio: model(
    [
      workspace("w-warehouse", "warehouse"),
      workspace("w-polaris", "polaris"),
      workspace("w-nj", "nj-homes"),
    ],
    {
      sessions: new Map([[orchestrator.id, entry]]),
      reviewCheckouts: new Map([[checkout88.id, checkout88]]),
    }
  ),
  "linux-vm": model([
    workspace("w-sightline", "sightline"),
    workspace("w-warehouse-2", "warehouse"),
  ]),
};

const at = (hostKey: string, workspaceId: string): WorkspaceRef => ({ hostKey, workspaceId });

const pull = (
  id: string,
  seed: Pick<PullRowView, "number" | "title" | "repo"> &
    Partial<PullRowView> & { readonly by: string; readonly minutes: number }
): PullRowView => ({
  id,
  url: `https://github.com/${seed.repo}/pull/${seed.number}`,
  isDraft: false,
  author: { login: seed.by, avatarUrl: "" },
  headRefName: `${seed.by}/branch`,
  headRefOid: "4f2c1a9",
  baseRefName: "main",
  additions: 10,
  deletions: 2,
  updatedAt: ago(seed.minutes),
  reviewDecision: "review-required",
  viewerLatestReview: null,
  requestedReviewers: [],
  accountId: 1,
  workspaces: [],
  ...seed,
});

const POLARIS = [at("local", "w-polaris")];

export const LIST: PullListView = {
  requested: [
    pull("PR_88", {
      number: 88,
      title: "Eligibility: annual income field",
      repo: "work-org/nj-homes-choice-next",
      by: "mchen",
      minutes: 120,
      additions: 48,
      deletions: 12,
      accountId: 2,
      workspaces: [at("studio", "w-nj")],
    }),
    pull("PR_431", {
      number: 431,
      title: "pg17: rollup views",
      repo: "dcai-labs/warehouse",
      by: "priya",
      minutes: 300,
      additions: 312,
      deletions: 40,
      accountId: 2,
      workspaces: [at("studio", "w-warehouse"), at("linux-vm", "w-warehouse-2")],
    }),
  ],
  mine: [
    pull("PR_212", {
      number: 212,
      title: "Review checkout cleanup job",
      repo: "lucasdoell/polaris",
      by: "lucasdoell",
      minutes: 60 * 26,
      isDraft: true,
      headRefName: "lucas/checkout-cleanup",
      additions: 96,
      deletions: 8,
      workspaces: POLARIS,
    }),
    pull("PR_209", {
      number: 209,
      title:
        "Research herdr and dagr’s DAG model, then port the rail list layout and the attempt lifecycle into the constellation view with notes",
      repo: "lucasdoell/polaris",
      by: "lucasdoell",
      minutes: 60 * 50,
      headRefName: "lucas/eng-169-research-herdr-dagrs-dag-model",
      additions: 1204,
      deletions: 0,
      workspaces: POLARIS,
    }),
  ],
  other: [
    pull("PR_17", {
      number: 17,
      title: "Fight window heuristics",
      repo: "lucasdoell/sightline",
      by: "kkim",
      minutes: 60 * 74,
      additions: 61,
      deletions: 27,
      workspaces: [at("linux-vm", "w-sightline")],
    }),
    pull("PR_233", {
      number: 233,
      title: "Bump effect to 4.0.0-rc.119",
      repo: "lucasdoell/polaris",
      by: "renovate",
      minutes: 60 * 98,
      additions: 14,
      deletions: 14,
      workspaces: POLARIS,
    }),
  ],
  repos: [
    {
      repo: "acme-corp/api",
      state: "not-found",
      accountId: null,
      login: "lucasdoell",
      permission: null,
      approvalUrl: null,
      ssoUrl: null,
      workspaces: [at("studio", "w-api"), at("studio", "w-web")],
    },
  ],
  updatedAt: Date.now() - 60_000,
  polling: "focused",
  throttledUntil: null,
  error: null,
};

const account = (id: number, login: string) => ({
  id,
  login,
  name: null,
  // A data URL: the preview's CSP allows no remote images.
  avatarUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  scopes: ["repo", "read:org"],
  missingScopes: [],
  state: "ok" as const,
  signedInAt: null,
  signedOutAt: null,
});

export const ACCOUNTS: GitHubAccountsView = {
  accounts: [account(1, "lucasdoell"), account(2, "lmd-work")],
  signIn: null,
  owners: {},
  workspaces: {},
  storageAvailable: true,
  manageUrl: "https://github.com/settings/applications",
};

export const SIGNED_OUT: GitHubAccountsView = { ...ACCOUNTS, accounts: [] };

export const EMPTY_LIST: PullListView = { ...LIST, requested: [], mine: [], other: [], repos: [] };

/** What the risk lane reads of a summary: a cached one for #88 and the open session's. */
export const RISK = {
  pull88: { status: "completed", findings: [{ severity: "high", status: "open" }] },
  session: { status: "completed", findings: [{ severity: "critical", status: "open" }] },
  mine212: {
    status: "completed",
    findings: [
      { severity: "low", status: "open" },
      { severity: "low", status: "open" },
    ],
  },
} as const;
