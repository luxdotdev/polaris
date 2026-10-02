/**
 * Settings fakes for the Constellation previews: a Host's resources and worker cap (bench
 * held by B2 past its limit, B3 queued), and Usage buckets for both Constellations' sessions.
 */
import { AttemptId, ConstellationId, HostId, Sequence, SessionId } from "@polaris/protocol";
import type {
  ConstellationStatsView,
  PricedStatsUsage,
  Result,
  UsageQueryView,
} from "../../../../shared/api.ts";
import type { DraftBatch } from "../../comments/model/feedback.ts";
import type { HostResourcesSnapshot } from "../../settings/model/resources.ts";
import type { ResourcesClient } from "../../settings/resources.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let snapshot: HostResourcesSnapshot = {
  resources: [
    { hostId: HostId.make("h-local"), name: "bench", capacity: 1 },
    { hostId: HostId.make("h-local"), name: "smoke", capacity: 1, holdLimitMs: 20 * 60_000 },
  ],
  resourceLeases: [
    {
      id: "req-b2",
      hostId: HostId.make("h-local"),
      resource: "bench",
      sessionId: SessionId.make("b2"),
      attemptId: AttemptId.make("c1-B2-1"),
      command: ["bun", "run", "bench", "idle"],
      processId: 4242,
      acquiredAt: ago(34),
    },
  ],
  waiting: [{ resource: "bench", requestId: "req-b3" }],
  overdueLeaseIds: ["req-b2"],
  workerCap: { cap: 4, default: 4, working: 4, waiting: 1 },
};

const ok = (): Promise<Result<HostResourcesSnapshot>> =>
  Promise.resolve({ ok: true, value: snapshot });

export const fakeResources: ResourcesClient = {
  get: ok,
  declare: (_hostKey, { name, capacity }) => {
    snapshot = {
      ...snapshot,
      resources: [
        ...snapshot.resources,
        { hostId: HostId.make("h-local"), name, capacity: capacity ?? 1 },
      ],
    };

    return ok();
  },
  remove: (_hostKey, name) => {
    snapshot = { ...snapshot, resources: snapshot.resources.filter((r) => r.name !== name) };

    return ok();
  },
  release: (_hostKey, leaseId) => {
    snapshot = {
      ...snapshot,
      resourceLeases: snapshot.resourceLeases.filter((l) => l.id !== leaseId),
      overdueLeaseIds: snapshot.overdueLeaseIds.filter((id) => id !== leaseId),
    };

    return ok();
  },
  setCap: (_hostKey, cap) => {
    snapshot = {
      ...snapshot,
      workerCap: { ...snapshot.workerCap, cap: cap ?? snapshot.workerCap.default },
    };

    return ok();
  },
};

const tokens = (n: number) => ({
  input: Math.round(n * 0.1),
  cacheRead: Math.round(n * 0.75),
  cacheWrite: Math.round(n * 0.05),
  output: Math.round(n * 0.1),
  reasoning: Math.round(n * 0.04),
  cacheWrite1h: 0,
});

const hourAgo = (hours: number) => {
  const d = new Date(Date.now() - hours * 3_600_000);

  d.setUTCMinutes(0, 0, 0);

  return d.toISOString();
};

const SPEND: ReadonlyArray<readonly [string, "claude" | "codex", number, number]> = [
  ["lead-c1", "claude", 1, 4_200_000],
  ["lead-c1", "claude", 2, 3_100_000],
  ["a1", "codex", 3, 6_800_000],
  ["a2", "codex", 3, 5_200_000],
  ["b1", "codex", 1, 3_900_000],
  ["b2", "codex", 1, 2_700_000],
  ["b3", "codex", 0, 1_400_000],
  ["b5", "codex", 0, 900_000],
  ["lead-c2", "codex", 0, 1_200_000],
  ["l1", "codex", 0, 2_100_000],
  ["l2", "codex", 0, 600_000],
  ["glossary", "claude", 24, 800_000],
];

export const USAGE: UsageQueryView = {
  report: {
    buckets: SPEND.map(([sessionId, harness, hours, n]) => ({
      hour: hourAgo(hours),
      harness,
      model: harness === "codex" ? "gpt-6.1-sol" : "claude-opus-5-5",
      sessionId: SessionId.make(sessionId),
      tokens: tokens(n),
      reportedCost: null,
      longContext: [],
    })),
    indexedAt: ago(1),
    indexing: false,
  },
  estimates: SPEND.map(([, , , n]) => ({ estimatedUsd: n / 1_000_000, unpricedTokens: 0 })),
  pricesFetchedAt: ago(60),
};

/** B1's Review feedback (Paper C4): one comment on the Quint spec, waiting to go back. */
export const B1_FEEDBACK: DraftBatch = {
  message: "",
  comments: [
    {
      id: "fb-1",
      path: "packages/spec/polaris.qnt",
      lines: { start: 212, end: 212, side: "new" },
      code: "val gatePromotedOnce = promotions.size() <= gates.size()",
      note: "gatePromotedOnce should count promotions per Gate, not globally.",
      findingId: null,
    },
  ],
};

const statsUsage = (sessionId: string, n: number): PricedStatsUsage => ({
  tokens: tokens(n),
  reportedUsd: 0,
  reportedTokens: tokens(0),
  buckets: [
    {
      hour: hourAgo(1),
      harness: sessionId.startsWith("lead") ? "claude" : "codex",
      model: sessionId.startsWith("lead") ? "claude-opus-5-5" : "gpt-6.1-sol",
      sessionId: SessionId.make(sessionId),
      tokens: tokens(n),
      reportedCost: null,
      longContext: [],
    },
  ],
  estimates: [{ estimatedUsd: n / 1_000_000, unpricedTokens: 0 }],
});

const ROLE_ZERO = {
  workingMs: null,
  idleMs: null,
  waitingForSlotMs: null,
  waitingOnLeaseMs: null,
  staleMs: null,
};

/** C1's stats from its Lead's Host: per-response Usage for the Lead and its local workers. */
export const C1_STATS: ConstellationStatsView = {
  stats: {
    constellationId: ConstellationId.make("c1"),
    revision: 37,
    hostId: HostId.make("h-local"),
    asOf: ago(0),
    sequence: Sequence.make(400),
    wallClockMs: 134 * 60_000,
    usageIndexedAt: ago(1),
    indexing: false,
    lead: {
      wakeups: 4,
      deliveredItems: 9,
      coalescedItems: 5,
      coalescingHitRate: 5 / 9,
      meanTokensPerDigest: 1_800_000,
      meanReportedUsdPerDigest: null,
      digests: [],
    },
    review: {
      decidedClaims: 3,
      meanClaimToReviewMs: 6 * 60_000,
      medianClaimToReviewMs: 5 * 60_000,
      acceptedFirstTime: 2,
      firstClaimsReviewed: 3,
      firstTimeAcceptanceRate: 2 / 3,
      sendBacksByCause: [],
    },
    workers: { totals: ROLE_ZERO, attempts: [] },
    usage: {
      total: statsUsage("lead-c1", 0),
      perTask: [],
      perRole: [],
    },
    coverage: [
      {
        metric: "usage.remote",
        reason: "This host can't read B4's usage on devbox.",
        attemptId: AttemptId.make("c1-B4-1"),
      },
    ],
  },
  usage: {
    total: statsUsage("lead-c1", 31_000_000),
    perTask: [
      { taskId: "A1", usage: statsUsage("a1", 6_800_000) },
      { taskId: "A2", usage: statsUsage("a2", 5_200_000) },
      { taskId: "B1", usage: statsUsage("b1", 3_900_000) },
      { taskId: "B2", usage: statsUsage("b2", 2_700_000) },
      { taskId: "B3", usage: statsUsage("b3", 1_400_000) },
      { taskId: "B5", usage: statsUsage("b5", 900_000) },
    ],
    perRole: [
      { role: "lead", usage: statsUsage("lead-c1", 7_300_000) },
      { role: "worker", usage: statsUsage("a1", 20_900_000) },
    ],
  },
  pricesFetchedAt: ago(60),
};
