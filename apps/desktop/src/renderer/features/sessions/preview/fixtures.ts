/**
 * Two Constellations in one Workspace (Paper C1, C5): "Constellations v1" led by a Claude Code
 * session with seven workers (one on devbox), and "Bench leases" led by Codex with three; plus
 * a plain session. Shared by the sidebar, Needs you, Review, Settings and Usage previews.
 */
import {
  AgentSession,
  ApprovalRequest,
  Attempt,
  AttemptCause,
  AttemptId,
  Capability,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationNotification,
  ConstellationQuestion,
  ConstellationSettings,
  ContextUsage,
  HostId,
  NotificationItem,
  RequestId,
  Sequence,
  SessionId,
  Task,
  TaskId,
  TaskProjection,
  TaskState,
  ToolCallReference,
  TurnId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { type HostModel, modelFromSnapshot, type SessionEntry } from "../../../store/hostModel.ts";
import type { ConstellationView } from "../source.ts";

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
      platform: key === "local" ? "darwin-arm64" : "linux-x64",
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
  hostView("devbox", "devbox"),
];

const LOCAL = HostId.make("h-local");

const DEVBOX = HostId.make("h-devbox");

const POLARIS = WorkspaceId.make("w-polaris");

interface SessionSeed {
  readonly id: string;
  readonly harness: "claude" | "codex";
  readonly title: string;
  readonly state: AgentSession["state"];
  readonly minutes: number;
  /** Context used, 0–1. */
  readonly context?: number;
}

const session = (seed: SessionSeed) =>
  new AgentSession({
    id: SessionId.make(seed.id),
    workspaceId: POLARIS,
    harness: seed.harness,
    title: seed.title,
    cwd: "/Users/lucas/code/polaris",
    worktreeId: null,
    state: seed.state,
    permissionMode: "supervised",
    model: seed.harness === "codex" ? "gpt-6.1-sol" : "claude-opus-5-5",
    effort: "high",
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 6,
    contextUsage:
      seed.context === undefined
        ? null
        : new ContextUsage({
            usedTokens: Math.round(seed.context * 400_000),
            windowTokens: 400_000,
          }),
    lastError: null,
    createdAt: ago(seed.minutes),
    updatedAt: ago(Math.min(seed.minutes, 2)),
  });

const entry = (s: AgentSession, pending: ReadonlyArray<ApprovalRequest> = []): SessionEntry => ({
  session: s,
  pendingApprovals: pending,
  lastTurnPreview: null,
  subagents: [],
});

const approval = (sessionId: string, detail: string, minutes: number) =>
  new ApprovalRequest({
    id: RequestId.make(`r-${sessionId}`),
    sessionId: SessionId.make(sessionId),
    turnId: TurnId.make(`${sessionId}-t5`),
    kind: "command",
    title: "Run a command",
    detail,
    options: [],
    openedAt: ago(minutes),
  });

interface TaskSeed {
  readonly id: string;
  readonly title: string;
  readonly kind?: "task" | "gate";
  readonly deps?: ReadonlyArray<string>;
  readonly area?: ReadonlyArray<string>;
  readonly group: string;
}

const task = (seed: TaskSeed) =>
  new Task({
    id: TaskId.make(seed.id),
    title: seed.title,
    kind: seed.kind ?? "task",
    deps: (seed.deps ?? []).map((d) => TaskId.make(d)),
    area: [...(seed.area ?? [])],
    brief: `${seed.title}: see the spec.`,
    criteria: [],
    suggested: null,
    group: seed.group,
    revision: 1,
    canceled: false,
  });

interface AttemptSeed {
  readonly constellation: string;
  readonly task: string;
  readonly session: string;
  readonly lead: string;
  readonly state: Attempt["state"];
  readonly minutes: number;
  readonly host?: HostId;
  readonly claim?: Claim;
  /** Minutes since the Daemon's one nudge. */
  readonly nudged?: number;
  /** Minutes since the Lead handed the Claim up. */
  readonly handedUp?: number;
}

const attempt = (seed: AttemptSeed) =>
  new Attempt({
    id: AttemptId.make(`${seed.constellation}-${seed.task}-1`),
    taskId: TaskId.make(seed.task),
    revision: 2,
    cause: AttemptCause.cases.Initial.make({}),
    by: SessionId.make(seed.lead),
    sessionId: SessionId.make(seed.session),
    hostId: seed.host ?? LOCAL,
    worktree: `/Users/lucas/code/polaris.worktrees/${seed.constellation}/${seed.task}`,
    branch: `polaris/${seed.constellation}/${seed.task.toLowerCase()}`,
    base: "main",
    state: seed.state,
    claim: seed.claim ?? null,
    nudgedAt: seed.nudged === undefined ? null : ago(seed.nudged),
    handedUpAt: seed.handedUp === undefined ? null : ago(seed.handedUp),
    handedUpReason: seed.handedUp === undefined ? null : "It can't decide the question",
    approvedByUserAt: null,
    mergedHead: seed.state === "accepted" ? "8e41d07" : null,
    receipts: [],
    evidence: seed.state === "accepted" ? "verified" : null,
    startedAt: ago(seed.minutes),
    endedAt: null,
  });

const ref = (sessionId: string, item: string) =>
  new ToolCallReference({
    hostId: LOCAL,
    sessionId: SessionId.make(sessionId),
    turnId: TurnId.make(`${sessionId}-t5`),
    itemId: item,
  });

/** B1's Claim (Paper C3): spec and tests pass, trace fails, a question for the user. */
export const B1_QUESTION = new ConstellationQuestion({
  id: "q-b1-overlap",
  to: "user",
  text: "May two leads overlap during a handover?",
  blocking: true,
});

const B1_CLAIM = new Claim({
  branch: "polaris/c1/b1",
  head: "3f9c2e1",
  commits: ["3f9c2e1", "a1b2c3d", "b2c3d4e", "c3d4e5f", "d4e5f60", "e5f6071"],
  receipts: [
    CheckReceipt.cases.Verified.make({ label: "bun run spec", item: ref("b1", "i-spec") }),
    CheckReceipt.cases.Verified.make({
      label: "bun test …/verification",
      item: ref("b1", "i-test"),
    }),
    CheckReceipt.cases.Reported.make({
      label: "trace validation",
      text: "handover.ndjson fails",
      command: "bun run spec:trace handover.ndjson",
      exitCode: 1,
    }),
  ],
  notDone: ["Trace for handover (needs B5)"],
  followups: [],
  questions: [B1_QUESTION],
  outsideArea: [],
  decisions: ["Counted promotions per Gate"],
  summary: "Seven of eight properties hold; the handover trace waits on B5.",
});

const C1_ID = "c1";

const LEAD = "lead-c1";

const C1_TASKS = [
  task({ id: "A1", title: "Constellation events and stream", group: "A · Events and decider" }),
  task({ id: "A2", title: "Decider and projections", group: "A · Events and decider" }),
  task({
    id: "G1",
    title: "Engine merged to main",
    kind: "gate",
    deps: ["A1", "A2"],
    group: "A · Events and decider",
  }),
  task({ id: "B1", title: "Quint properties", deps: ["G1"], group: "B · Spec and tools" }),
  task({
    id: "B2",
    title: "Lead and worker MCP tools",
    deps: ["G1"],
    area: ["apps/daemon/src/mcp/**"],
    group: "B · Spec and tools",
  }),
  task({
    id: "B3",
    title: "Tool eval on the bench harness",
    deps: ["G1"],
    group: "B · Spec and tools",
  }),
  task({ id: "B4", title: "Streamable-HTTP endpoint", deps: ["G1"], group: "B · Spec and tools" }),
  task({
    id: "B5",
    title: "Trace validation for handover",
    deps: ["G1"],
    group: "B · Spec and tools",
  }),
  task({
    id: "G2",
    title: "Spec and tools merged",
    kind: "gate",
    deps: ["B1", "B2", "B3", "B4", "B5"],
    group: "B · Spec and tools",
  }),
];

const c1Attempt = (t: string, s: string, state: Attempt["state"], minutes: number) =>
  attempt({ constellation: C1_ID, task: t, session: s, lead: LEAD, state, minutes });

const C1_ATTEMPTS = [
  c1Attempt("A1", "a1", "accepted", 180),
  c1Attempt("A2", "a2", "accepted", 170),
  c1Attempt("G1", LEAD, "accepted", 90),
  attempt({
    constellation: C1_ID,
    task: "B1",
    session: "b1",
    lead: LEAD,
    state: "review",
    minutes: 41,
    claim: B1_CLAIM,
  }),
  c1Attempt("B2", "b2", "working", 31),
  c1Attempt("B3", "b3", "working", 18),
  attempt({
    constellation: C1_ID,
    task: "B4",
    session: "b4",
    lead: LEAD,
    state: "review",
    minutes: 52,
    host: DEVBOX,
  }),
  attempt({
    constellation: C1_ID,
    task: "B5",
    session: "b5",
    lead: LEAD,
    state: "working",
    minutes: 26,
    nudged: 8,
  }),
];

const projection = (
  id: string,
  state: TaskState,
  extra: Partial<{ stale: boolean; branchFetched: boolean }> = {}
) =>
  new TaskProjection({
    taskId: TaskId.make(id),
    state,
    latestAttemptId: null,
    blockedBy: [],
    gatePromoted: false,
    stale: extra.stale ?? false,
    branchFetched: extra.branchFetched ?? true,
  });

const settings = new ConstellationSettings({
  branchPrefix: "polaris",
  transfer: "bundle",
  defaults: null,
  backend: null,
  ui: null,
});

/** "Constellations v1": the B row of C1 with B1's question waiting on the user. */
export const C1: ConstellationView = {
  constellation: new Constellation({
    id: ConstellationId.make(C1_ID),
    workspaceId: POLARIS,
    hostId: LOCAL,
    leadSessionId: SessionId.make(LEAD),
    name: "Constellations v1",
    state: "running",
    revision: 37,
    settings,
    tasks: C1_TASKS,
    attempts: C1_ATTEMPTS,
    pendingNotifications: [
      new ConstellationNotification({
        id: "n-b1-q",
        item: NotificationItem.cases.Question.make({
          attemptId: AttemptId.make("c1-B1-1"),
          question: B1_QUESTION,
        }),
        queuedAt: ago(3),
      }),
    ],
    createdAt: ago(120),
    updatedAt: ago(1),
  }),
  projections: [
    projection("A1", "done"),
    projection("A2", "done"),
    projection("G1", "done"),
    projection("B1", "review"),
    projection("B2", "working"),
    projection("B3", "working"),
    projection("B4", "review", { branchFetched: false }),
    projection("B5", "working"),
    projection("G2", "waiting"),
  ],
};

const C2_ID = "c2";

const LEAD2 = "lead-c2";

/** "Bench leases": L2 waits on an approval, L1 is near its context limit (Paper C5). */
export const C2: ConstellationView = {
  constellation: new Constellation({
    id: ConstellationId.make(C2_ID),
    workspaceId: POLARIS,
    hostId: LOCAL,
    leadSessionId: SessionId.make(LEAD2),
    name: "Bench leases",
    state: "running",
    revision: 12,
    settings,
    tasks: [
      task({ id: "L1", title: "Lease stream", group: "L · Leases" }),
      task({ id: "L2", title: "Daemon restart keeps leases", group: "L · Leases" }),
      task({ id: "L3", title: "polaris lease wrapper", group: "L · Leases" }),
    ],
    attempts: [
      attempt({
        constellation: C2_ID,
        task: "L1",
        session: "l1",
        lead: LEAD2,
        state: "working",
        minutes: 35,
      }),
      attempt({
        constellation: C2_ID,
        task: "L2",
        session: "l2",
        lead: LEAD2,
        state: "working",
        minutes: 20,
      }),
      attempt({
        constellation: C2_ID,
        task: "L3",
        session: "l3",
        lead: LEAD2,
        state: "working",
        minutes: 12,
      }),
    ],
    pendingNotifications: [],
    createdAt: ago(40),
    updatedAt: ago(1),
  }),
  projections: [
    projection("L1", "working"),
    projection("L2", "working"),
    projection("L3", "working"),
  ],
};

export const VIEWS = { local: [C1, C2] } as const;

const LOCAL_ENTRIES: ReadonlyArray<SessionEntry> = [
  entry(
    session({
      id: LEAD,
      harness: "claude",
      title: "Constellations v1 lead",
      state: "working",
      minutes: 120,
      context: 0.58,
    })
  ),
  entry(
    session({
      id: "a1",
      harness: "codex",
      title: "A1 · Constellation events and stream",
      state: "idle",
      minutes: 180,
    })
  ),
  entry(
    session({
      id: "a2",
      harness: "codex",
      title: "A2 · Decider and projections",
      state: "idle",
      minutes: 170,
    })
  ),
  entry(
    session({
      id: "b1",
      harness: "codex",
      title: "B1 · Quint properties",
      state: "idle",
      minutes: 41,
    })
  ),
  entry(
    session({
      id: "b2",
      harness: "codex",
      title: "B2 · Lead and worker MCP tools",
      state: "working",
      minutes: 31,
      context: 0.61,
    })
  ),
  entry(
    session({
      id: "b3",
      harness: "codex",
      title: "B3 · Tool eval on the bench harness",
      state: "working",
      minutes: 18,
      context: 0.48,
    })
  ),
  entry(
    session({
      id: "b5",
      harness: "codex",
      title: "B5 · Trace validation for handover",
      state: "idle",
      minutes: 26,
    })
  ),
  entry(
    session({
      id: LEAD2,
      harness: "codex",
      title: "Bench leases lead",
      state: "idle",
      minutes: 40,
      context: 0.4,
    })
  ),
  entry(
    session({
      id: "l1",
      harness: "codex",
      title: "L1 · Lease stream",
      state: "working",
      minutes: 35,
      context: 0.92,
    })
  ),
  entry(
    session({
      id: "l2",
      harness: "codex",
      title: "L2 · Daemon restart keeps leases",
      state: "needs-you",
      minutes: 20,
    }),
    [approval("l2", "systemctl --user restart polaris", 1)]
  ),
  entry(
    session({
      id: "l3",
      harness: "codex",
      title: "L3 · polaris lease wrapper",
      state: "working",
      minutes: 12,
    })
  ),
  entry(
    session({
      id: "glossary",
      harness: "claude",
      title: "Glossary first pass",
      state: "dormant",
      minutes: 1440,
    })
  ),
];

const model = (
  workspaces: ReadonlyArray<Workspace>,
  entries: ReadonlyArray<SessionEntry>
): HostModel => ({
  ...modelFromSnapshot({ sequence: Sequence.make(40), workspaces, worktrees: [], sessions: [] }),
  sessions: new Map(entries.map((e) => [e.session.id, e])),
  synchronized: true,
});

const polaris = new Workspace({
  id: POLARIS,
  path: "/Users/lucas/code/polaris",
  name: "polaris",
  isGitRepo: true,
  worktreeRoot: "/Users/lucas/code/polaris.worktrees",
  hidden: false,
  registeredAt: ago(60 * 24 * 30),
});

export const MODELS = {
  local: model([polaris], LOCAL_ENTRIES),
  devbox: model(
    [polaris],
    [
      entry(
        session({
          id: "b4",
          harness: "codex",
          title: "B4 · Streamable-HTTP endpoint",
          state: "idle",
          minutes: 52,
        })
      ),
    ]
  ),
} satisfies Readonly<Record<string, HostModel>>;

export const LEAD_SESSION = { hostKey: "local", sessionId: SessionId.make(LEAD) } as const;

export const WORKER_B1 = { hostKey: "local", sessionId: SessionId.make("b1") } as const;
