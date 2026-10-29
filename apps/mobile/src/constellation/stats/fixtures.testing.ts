/** Paper MX-AB's constellation and its `constellation.stats`, for the stats tests. */
import {
  Attempt,
  AttemptCause,
  AttemptId,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  ConstellationStats,
  HarnessSelection,
  HostId,
  Sequence,
  SessionId,
  type StatsUsage,
  Task,
  TaskId,
  TaskProjection,
  TokenCounts,
  WorkspaceId,
} from "@polaris/protocol";

const MINUTE = 60_000;

export const tokens = (input: number, output = 0) =>
  new TokenCounts({ input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0, cacheWrite1h: 0 });

/** A section the Harness reported in full, or (`reported: false`) not at all. */
export const usage = (n: number, usd: number, reported = true): StatsUsage => ({
  tokens: tokens(n),
  reportedUsd: reported ? usd : 0,
  reportedTokens: reported ? tokens(n) : tokens(0),
  buckets: [],
});

const times = (working: number | null) => ({
  workingMs: working === null ? null : working * MINUTE,
  idleMs: null,
  waitingForSlotMs: null,
  waitingOnLeaseMs: null,
  staleMs: null,
});

export const task = (
  id: string,
  extra: Partial<Pick<Task, "kind" | "parent" | "canceled" | "suggested">> = {}
) =>
  new Task({
    id: TaskId.make(id),
    title: `Task ${id}`,
    kind: extra.kind ?? "task",
    brief: "",
    deps: [],
    area: [],
    criteria: [],
    suggested: extra.suggested ?? null,
    group: null,
    parent: extra.parent ?? null,
    revision: 0,
    canceled: extra.canceled ?? false,
  });

export const attempt = (taskId: string, n: number, extra: Partial<Attempt> = {}) =>
  new Attempt({
    id: AttemptId.make(`${taskId}-a${n}`),
    taskId: TaskId.make(taskId),
    revision: 3,
    cause: AttemptCause.cases.Initial.make({}),
    by: SessionId.make("lead"),
    sessionId: SessionId.make(`${taskId}-w${n}`),
    hostId: HostId.make("mac"),
    worktree: `/w/${taskId}`,
    branch: `lucas/${taskId.toLowerCase()}`,
    base: "main",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: "2026-10-29T10:00:00Z",
    ...extra,
  });

export const claim = (head: string, branch: string, extra: Partial<Claim> = {}) =>
  new Claim({
    branch,
    head,
    commits: [head],
    receipts: [],
    notDone: [],
    followups: [],
    questions: [],
    outsideArea: [],
    decisions: [],
    summary: "",
    ...extra,
  });

export const constellation = (
  tasks: ReadonlyArray<Task>,
  attempts: ReadonlyArray<Attempt> = [],
  state: Constellation["state"] = "running"
) =>
  new Constellation({
    id: ConstellationId.make("c1"),
    workspaceId: WorkspaceId.make("ws"),
    hostId: HostId.make("mac"),
    leadSessionId: SessionId.make("lead"),
    name: "Polaris planning",
    state,
    revision: 7,
    settings: new ConstellationSettings({}),
    tasks,
    attempts,
    pendingNotifications: [],
    openQuestions: [],
    createdAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T11:12:00Z",
  });

export const projection = (taskId: string, state: TaskProjection["state"], latest?: string) =>
  new TaskProjection({
    taskId: TaskId.make(taskId),
    state,
    latestAttemptId: latest === undefined ? null : AttemptId.make(latest),
    blockedBy: [],
    gatePromoted: false,
    stale: false,
    branchFetched: true,
    liveness: null,
  });

const claude = new HarnessSelection({ harness: "claude" });

const codex = new HarnessSelection({ harness: "codex" });

/** MX-AB: A4, B3 and C1 working longest, five shorter tasks behind them. */
export const mxAbConstellation = constellation([
  task("A4", { suggested: claude }),
  task("B3", { suggested: codex }),
  task("C1", { suggested: claude }),
  ...["D1", "D2", "D3", "D4", "D5"].map((id) => task(id)),
  task("P", {}),
  task("P1", { parent: TaskId.make("P") }),
  task("P2", { parent: TaskId.make("P") }),
  task("X", { canceled: true }),
  task("G1", { kind: "gate" }),
]);

const workerAttempt = (taskId: string, n: number, working: number | null) => ({
  attemptId: AttemptId.make(`${taskId}-a${n}`),
  taskId: TaskId.make(taskId),
  sessionId: SessionId.make(`${taskId}-w${n}`),
  times: times(working),
});

export const stats = (
  extra: {
    readonly total?: StatsUsage;
    readonly lead?: StatsUsage;
    readonly worker?: StatsUsage;
    readonly review?: { readonly accepted: number; readonly reviewed: number };
    readonly wallClockMs?: number;
    readonly workers?: ConstellationStats["workers"];
  } = {}
) =>
  new ConstellationStats({
    constellationId: ConstellationId.make("c1"),
    revision: 7,
    hostId: HostId.make("mac"),
    asOf: "2026-10-29T11:12:00Z",
    sequence: Sequence.make(40),
    wallClockMs: extra.wallClockMs ?? 72 * MINUTE,
    usageIndexedAt: null,
    indexing: false,
    lead: {
      wakeups: 4,
      deliveredItems: 6,
      coalescedItems: 2,
      coalescingHitRate: null,
      meanTokensPerDigest: null,
      meanReportedUsdPerDigest: null,
      digests: [],
    },
    review: {
      decidedClaims: 5,
      meanClaimToReviewMs: null,
      medianClaimToReviewMs: null,
      acceptedFirstTime: extra.review?.accepted ?? 4,
      firstClaimsReviewed: extra.review?.reviewed ?? 5,
      firstTimeAcceptanceRate: null,
      sendBacksByCause: [],
    },
    workers: extra.workers ?? {
      totals: times(161),
      attempts: [
        workerAttempt("A4", 1, 20),
        workerAttempt("A4", 2, 11),
        workerAttempt("B3", 1, 18),
        workerAttempt("C1", 1, 12),
        workerAttempt("D1", 1, 10),
        workerAttempt("D2", 1, 8),
        workerAttempt("D3", 1, 5),
        workerAttempt("D4", 1, null),
        workerAttempt("D5", 1, 0),
      ],
    },
    usage: {
      total: extra.total ?? usage(2_400_000, 4.82),
      perTask: [],
      perRole: [
        { role: "lead", usage: extra.lead ?? usage(600_000, 1.1) },
        { role: "worker", usage: extra.worker ?? usage(1_800_000, 3.72) },
      ],
    },
    coverage: [],
  });
