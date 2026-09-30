/**
 * Fixtures for the Needs You preview, after Paper 1G2-0 and 1-0: waiting sessions on three
 * Hosts (an approval, a question), a Failed and an In Terminal session, an Interrupted Turn,
 * and an answer another device gave, so screenshots compare on content too.
 */
import {
  AgentSession,
  ApprovalRequest,
  Capability,
  HostId,
  RequestId,
  Sequence,
  SessionId,
  TurnId,
  Workspace,
  WorkspaceId,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { modelFromSnapshot, type HostModel, type SessionEntry } from "../../../store/hostModel.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const hostView = (key: string, label: string): HostView => ({
  key,
  label,
  colour: null,
  alias: key === "local" ? null : key,
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: {
      hostId: HostId.make(`h-${key}`),
      hostname: key,
      platform: "darwin-arm64",
      daemonVersion: "0.0.0",
      homeDir: "/Users/lucas",
      startedAt: ago(600),
    },
    capabilities: Capability.literals,
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
});

export const HOSTS: ReadonlyArray<HostView> = [
  hostView("local", "Mac Studio"),
  hostView("linux-vm", "Linux VM"),
  hostView("pi", "Raspberry Pi 4"),
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

interface SessionSeed {
  readonly id: string;
  readonly workspaceId: string;
  readonly harness: string;
  readonly title: string;
  readonly state: AgentSession["state"];
  readonly minutes: number;
  readonly lastError?: string;
  readonly worktreeId?: string;
}

const session = (seed: SessionSeed) =>
  new AgentSession({
    id: SessionId.make(seed.id),
    workspaceId: WorkspaceId.make(seed.workspaceId),
    harness: seed.harness,
    title: seed.title,
    cwd: "/Users/lucas/code",
    worktreeId: seed.worktreeId === undefined ? null : WorktreeId.make(seed.worktreeId),
    state: seed.state,
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 9,
    lastError: seed.lastError ?? null,
    createdAt: ago(seed.minutes + 60),
    updatedAt: ago(seed.minutes),
  });

interface RequestSeed {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: ApprovalRequest["kind"];
  readonly title: string;
  readonly detail: string | null;
  readonly options?: ReadonlyArray<string>;
  readonly minutes: number;
}

const request = (seed: RequestSeed) =>
  new ApprovalRequest({
    id: RequestId.make(seed.id),
    sessionId: SessionId.make(seed.sessionId),
    turnId: TurnId.make(`${seed.sessionId}-t8`),
    kind: seed.kind,
    title: seed.title,
    detail: seed.detail,
    options: [...(seed.options ?? [])],
    openedAt: ago(seed.minutes),
  });

const entry = (
  s: AgentSession,
  pending: ReadonlyArray<ApprovalRequest> = [],
  extra: Partial<SessionEntry> = {}
): SessionEntry => ({
  session: s,
  pendingApprovals: pending,
  lastTurnPreview: null,
  subagents: [],
  ...extra,
});

const model = (
  workspaces: ReadonlyArray<Workspace>,
  entries: ReadonlyArray<SessionEntry>,
  worktrees: ReadonlyArray<Worktree> = []
): HostModel => ({
  ...modelFromSnapshot({ sequence: Sequence.make(40), workspaces, worktrees, sessions: [] }),
  sessions: new Map(entries.map((e) => [e.session.id, e])),
  synchronized: true,
});

const spike = session({
  id: "spike",
  workspaceId: "w-polaris",
  harness: "codex",
  title: "Spike GPUI review screen",
  state: "needs-you",
  minutes: 42,
  worktreeId: "wt-spike",
});

/** The spike's Worktree, whose branch the hover card names (Paper 1-0). */
const spikeWorktree = new Worktree({
  id: WorktreeId.make("wt-spike"),
  workspaceId: WorkspaceId.make("w-polaris"),
  path: "/Users/lucas/code/polaris.worktrees/spike-gpui-review",
  branch: "spike/gpui-review",
  head: "9c1e2d4",
  createdBySessionId: SessionId.make("spike"),
  isMain: false,
});

const eligibility = session({
  id: "eligibility",
  workspaceId: "w-nj",
  harness: "claude",
  title: "Fix eligibility form validation",
  state: "needs-you",
  minutes: 18,
});

/** The question session: selected in the inbox scene, as in 1G2-0. */
export const QUESTION = { hostKey: "linux-vm", sessionId: eligibility.id } as const;

/** The approval session: hovered in the hover scene, as in 1-0. */
export const APPROVAL = { hostKey: "local", sessionId: spike.id } as const;

export const MODELS = {
  local: model(
    [workspace("w-polaris", "polaris")],
    [
      entry(spike, [
        request({
          id: "r-spike",
          sessionId: "spike",
          kind: "command",
          title: "Run cargo build",
          detail: "cargo build --release -p review-spike",
          minutes: 42,
        }),
      ]),
      entry(
        session({
          id: "planning",
          workspaceId: "w-polaris",
          harness: "claude",
          title: "Polaris planning",
          state: "working",
          minutes: 1,
        })
      ),
      entry(
        session({
          id: "export",
          workspaceId: "w-polaris",
          harness: "claude",
          title: "Flaky export test",
          state: "in-terminal",
          minutes: 9,
        })
      ),
      entry(
        session({
          id: "layout",
          workspaceId: "w-polaris",
          harness: "claude",
          title: "Orchestrator layout prototype",
          state: "idle",
          minutes: 5,
        }),
        [],
        {
          resolved: [
            {
              request: request({
                id: "r-layout",
                sessionId: "layout",
                kind: "command",
                title: "Run bun test",
                detail: "bun test --coverage",
                minutes: 2,
              }),
              resolvedBy: "Lucas's iPhone",
              decision: "Allow",
              at: ago(0.2),
            },
          ],
        }
      ),
    ],
    [spikeWorktree]
  ),
  "linux-vm": model(
    [workspace("w-nj", "nj-homes")],
    [
      entry(eligibility, [
        request({
          id: "r-eligibility",
          sessionId: "eligibility",
          kind: "question",
          title: "Should household income be entered monthly or annually?",
          detail:
            "The API expects annual income, but the old form collected monthly. Annual keeps one unit end to end.",
          options: ["Annual", "Monthly, converted before submit"],
          minutes: 18,
        }),
      ]),
      entry(
        session({
          id: "migrate",
          workspaceId: "w-nj",
          harness: "codex",
          title: "Migrate reports to Postgres 17",
          state: "needs-you",
          minutes: 30,
        })
      ),
    ]
  ),
  pi: model(
    [workspace("w-home", "home")],
    [
      entry(
        session({
          id: "cron",
          workspaceId: "w-home",
          harness: "codex",
          title: "Home automation cron",
          state: "failed",
          minutes: 60,
          lastError: "out of memory on Pi 4",
        })
      ),
    ]
  ),
} satisfies Readonly<Record<string, HostModel>>;

/** Nothing waiting anywhere: the pane empty state (Paper 5SH-1). */
export const QUIET_MODELS = {
  local: model(
    [workspace("w-polaris", "polaris")],
    [
      entry(
        session({
          id: "planning",
          workspaceId: "w-polaris",
          harness: "claude",
          title: "Polaris planning",
          state: "working",
          minutes: 1,
        })
      ),
    ]
  ),
} satisfies Readonly<Record<string, HostModel>>;
