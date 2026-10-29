/**
 * Worst-case constellations for the gallery's stress toggle: one task, exactly 30, 120 across
 * 28 bands with long and non-Latin text, a completed run, and a Host that refuses stats.
 */
import {
  type Attempt,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  type ConstellationStats,
  HostId,
  SessionId,
  type StatsUsage,
  type Task,
  type TaskDefinition,
  TaskId,
  type TaskProjection,
} from "@polaris/protocol";
import type { ConstellationSource } from "../model.ts";
import { stats as mxAbStats, usage } from "../stats/fixtures.testing.ts";
import { attempt, deps, projection, source, task } from "./fixtures.testing.ts";

export type StressDataset = "one" | "thirty" | "worst" | "done" | "refused";

export interface StressData {
  readonly source: ConstellationSource;
  /** What `constellation.stats` answers; null is an older Host refusing it. */
  readonly stats: ConstellationStats | null;
}

const MINUTE = 60_000;

const ago = (now: number, minutes: number) => new Date(now - minutes * MINUTE).toISOString();

const BRANCH =
  "lucas/eng-559-8d906efe-3f31-4194-af2f-311c687f43af-r6-wire-c2-s-sheets-into-the-constellation-and-break-ui-review";

const TITLES = [
  "Migrate the event store's compaction to run incrementally on a Raspberry Pi 4 without stalling the Turn stream",
  "認証とセッション管理をリファクタリングする",
  "إعادة تصميم شاشة المضيفين",
  "Tiếng Việt: kiểm tra độ cao dòng chữ",
  "Fix 🔥 crash",
  "QA",
  "Ship the PR stack strip for ENG-543 (merged · open · draft · closed) with the purple pull-merged token",
];

const BANDS = [
  "Infrastructure and deployment pipelines for the Raspberry Pi fleet",
  "認証",
  "واجهة المستخدم",
  "QA",
];

const REASON =
  "The worker's claim changes the wire protocol's frame codec and adds a new device grant. That is a security decision about what a Linked Device may read, so I'm handing it to you instead of accepting it myself; the spec and the model-based tests pass, but the Quint trace validation was skipped because Java 17 isn't on this Host.";

const SUMMARY =
  "Rewrote the frame codec to stream large payloads in 64 KiB chunks, added `constellation.stats` to the device grants, and moved the resume cursor into the Client runtime so a reconnect after a long sleep doesn't replay the whole session. Also fixed a race in the outbox where a verdict sent twice during a reconnect would be recorded twice. 認証テストも追加しました。";

const RECEIPTS = [
  CheckReceipt.cases.Reported.make({
    label:
      "POLARIS_PBT_RUNS=500 bun test apps/daemon/src/verification --timeout 600000 --bail=false",
    text: "1,284 pass, 3 fail across 212 files in 9m 41s; see the attached log for the three model-based failures",
    exitCode: 1,
  }),
  CheckReceipt.cases.Reported.make({ label: "bun run typecheck", text: "ok", exitCode: 0 }),
  CheckReceipt.cases.Reported.make({ label: "Quint trace validation", text: "skipped" }),
  ...Array.from({ length: 9 }, (_, i) =>
    CheckReceipt.cases.Reported.make({ label: `smoke ${i + 1}`, text: "pass", exitCode: 0 })
  ),
];

const handedClaim = new Claim({
  branch: BRANCH,
  head: "4c19e2a77f0b9d1e",
  commits: [],
  receipts: RECEIPTS,
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: SUMMARY,
});

type Code = "d" | "w" | "r" | "b" | "a";

/** One code per task in a band: done, working, review (handed up), blocked, waiting. */
const CODES: ReadonlyArray<Code> = [
  "d",
  "d",
  "w",
  "r",
  "b",
  "a",
  "d",
  "d",
  "r",
  "w",
  "d",
  "b",
  "a",
  "a",
];

const codeAt = (n: number): Code => CODES[n % CODES.length] ?? "a";

const STATE_OF_CODE = {
  d: "done",
  w: "working",
  r: "review",
  b: "blocked",
  a: "waiting",
} as const satisfies Record<Code, TaskProjection["state"]>;

const ATTEMPT_OF_CODE = {
  d: "accepted",
  w: "working",
  r: "review",
  b: "blocked",
} as const satisfies Record<Exclude<Code, "a">, Attempt["state"]>;

const startedAttempt = (id: string, code: Exclude<Code, "a">, now: number): Attempt => {
  const extra: Partial<Attempt> = {
    branch: BRANCH,
    state: ATTEMPT_OF_CODE[code],
    startedAt: ago(now, 9 * 24 * 60),
  };

  if (code === "r")
    Object.assign(extra, {
      claim: handedClaim,
      claimedAt: ago(now, 6),
      handedUpAt: ago(now, 5),
      handedUpReason: REASON,
    });

  if (code === "d") Object.assign(extra, { claim: handedClaim, endedAt: ago(now, 30) });

  if (code === "b") Object.assign(extra, { blockedReason: REASON });

  return attempt(id, 1, extra);
};

interface Plan {
  readonly bands: number;
  readonly perBand: (band: number) => number;
  readonly code: (band: number, i: number) => Code;
}

/** Bands of chains: each task waits on the one before it, so the waves run deep. */
const planned = (plan: Plan, now: number) => {
  const tasks: Array<Task> = [];
  const projections: Array<TaskProjection> = [];
  const attempts: Array<Attempt> = [];

  for (let b = 0; b < plan.bands; b++)
    for (let i = 0; i < plan.perBand(b); i++) {
      const id = `T${b + 1}-${i + 1}`;
      const code = plan.code(b, i);

      const definition: Partial<TaskDefinition> = {
        title: TITLES[(b * 5 + i) % TITLES.length] ?? id,
        group: `${BANDS[b % BANDS.length] ?? "Band"} ${b + 1}`,
      };

      if (i > 0) Object.assign(definition, deps(`T${b + 1}-${i}`));
      tasks.push(task(id, definition));
      projections.push(projection(id, STATE_OF_CODE[code], code === "a" ? null : `${id}-a1`));

      if (code !== "a") attempts.push(startedAttempt(id, code, now));
    }

  return { tasks, projections, attempts };
};

const LONG_NAME =
  "Polaris 0.3 · Mobile chrome redesign phase 2 — review, constellation, hosts and the iPhone Duo (ENG-559)";

type Overrides = Partial<
  Pick<Constellation, "name" | "state" | "leadSessionId" | "hostId" | "createdAt" | "updatedAt">
>;

const withConstellation = (base: ConstellationSource, extra: Overrides): ConstellationSource => {
  const c = base.constellation;

  return {
    constellation: new Constellation({
      id: c.id,
      workspaceId: c.workspaceId,
      hostId: extra.hostId ?? c.hostId,
      leadSessionId: extra.leadSessionId ?? c.leadSessionId,
      name: extra.name ?? c.name,
      state: extra.state ?? c.state,
      revision: c.revision,
      settings: c.settings,
      tasks: c.tasks,
      attempts: c.attempts,
      pendingNotifications: c.pendingNotifications,
      createdAt: extra.createdAt ?? c.createdAt,
      updatedAt: extra.updatedAt ?? c.updatedAt,
    }),
    projections: base.projections,
  };
};

const zero = (): StatsUsage => usage(0, 0);

const NO_TIMES = {
  workingMs: null,
  idleMs: null,
  waitingForSlotMs: null,
  waitingOnLeaseMs: null,
  staleMs: null,
};

/** Nothing measured yet: no tokens, no review, no worker time. */
const zeroStats = () =>
  mxAbStats({
    total: zero(),
    lead: zero(),
    worker: zero(),
    review: { accepted: 0, reviewed: 0 },
    wallClockMs: 0,
    workers: { totals: NO_TIMES, attempts: [] },
  });

/** Nine days, 1.2 billion tokens, $12,345.67, 212 first claims reviewed, two attempts a task. */
const hugeStats = (tasks: ReadonlyArray<Task>) =>
  mxAbStats({
    total: usage(1_200_000_000, 12_345.67),
    lead: usage(200_000_000, 2_345.67),
    worker: usage(1_000_000_000, 10_000),
    review: { accepted: 47, reviewed: 212 },
    wallClockMs: 9 * 24 * 60 * MINUTE,
    workers: {
      totals: { ...NO_TIMES, workingMs: 61 * 24 * 60 * MINUTE },
      attempts: tasks.flatMap((t, i) =>
        [1, 2].map((n) => ({
          attemptId: AttemptId.make(`${t.id}-a${n}`),
          taskId: TaskId.make(t.id),
          sessionId: SessionId.make(`${t.id}-w${n}`),
          times: { ...NO_TIMES, workingMs: ((i % 17) + 1) * 37 * MINUTE },
        }))
      ),
    },
  });

const one = (now: number): StressData => {
  const { tasks, projections, attempts } = planned(
    { bands: 1, perBand: () => 1, code: () => "w" },
    now
  );

  return { source: source(tasks, projections, attempts), stats: zeroStats() };
};

const thirty = (now: number): StressData => {
  // Exactly the compression threshold: 30 stars still draw as waves, wrapping.
  const { tasks, projections, attempts } = planned(
    { bands: 3, perBand: () => 10, code: (b, i) => codeAt(b + i) },
    now
  );

  return { source: source(tasks, projections, attempts), stats: hugeStats(tasks) };
};

const worst = (now: number): StressData => {
  // 120 tasks over 28 bands, one band 14 deep; band letters run past Z.
  const { tasks, projections, attempts } = planned(
    {
      bands: 28,
      perBand: (b) => (b === 0 ? 14 : 3 + (b % 4)),
      code: (b, i) => codeAt(b * 3 + i),
    },
    now
  );

  const shown = tasks.slice(0, 120);
  const base = source(shown, projections.slice(0, 120), attempts);

  return { source: withConstellation(base, { name: LONG_NAME }), stats: hugeStats(shown) };
};

const done = (now: number): StressData => {
  const { tasks, projections, attempts } = planned(
    { bands: 4, perBand: () => 5, code: () => "d" },
    now
  );

  const gate = task("G1", { title: TITLES[0] ?? "", kind: "gate", ...deps("T1-5", "T2-5") });

  const gateAttempt = attempt("G1", 1, {
    state: "accepted",
    claim: handedClaim,
    branch: BRANCH,
    endedAt: ago(now, 3),
  });

  const base = source(
    [...tasks, gate],
    [...projections, projection("G1", "done", "G1-a1")],
    [...attempts, gateAttempt]
  );

  return {
    source: withConstellation(base, {
      name: LONG_NAME,
      state: "completed",
      updatedAt: ago(now, 2),
    }),
    stats: hugeStats(tasks),
  };
};

const build = (dataset: StressDataset, now: number): StressData => {
  if (dataset === "one") return one(now);

  if (dataset === "thirty") return thirty(now);

  if (dataset === "done") return done(now);

  const data = worst(now);

  return dataset === "refused" ? { ...data, stats: null } : data;
};

/** A stress dataset led by `lead`'s session, started nine days before `now`. */
export const stressConstellation = (
  dataset: StressDataset,
  lead: { readonly sessionId: string; readonly hostId: string },
  now: number
): StressData => {
  const data = build(dataset, now);

  return {
    ...data,
    source: withConstellation(data.source, {
      leadSessionId: SessionId.make(lead.sessionId),
      hostId: HostId.make(lead.hostId),
      createdAt: ago(now, 9 * 24 * 60),
    }),
  };
};
