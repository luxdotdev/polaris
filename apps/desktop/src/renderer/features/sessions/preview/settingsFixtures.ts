/**
 * Settings fakes for the Constellation previews: a Host's resources and worker cap (bench
 * held by B2 past its limit, B3 queued), and Usage buckets for both Constellations' sessions.
 */
import { AttemptId, HostId, SessionId } from "@polaris/protocol";
import type { Result, UsageQueryView } from "../../../../shared/api.ts";
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
  workerCap: { cap: null, default: 4, working: 4, waiting: 1 },
};

const ok = (): Promise<Result<HostResourcesSnapshot>> =>
  Promise.resolve({ ok: true, value: snapshot });

export const fakeResources: ResourcesClient = {
  get: ok,
  declare: (_hostKey, { name, capacity }) => {
    snapshot = {
      ...snapshot,
      resources: [...snapshot.resources, { hostId: HostId.make("h-local"), name, capacity }],
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
    snapshot = { ...snapshot, workerCap: { ...snapshot.workerCap, cap } };

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
