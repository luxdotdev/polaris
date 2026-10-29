/**
 * The break-UI pass (ENG-499) on the constellation glance: `#constellation/worst-…` on worst-case
 * graphs. One Task; 80 Tasks over 15 waves with deep nesting, many gates, slug ids and long
 * titles; every Task failed; every Task accepted; and a graph with cycles the Daemon would refuse.
 */
import type { Task } from "@polaris/protocol";
import { startedRecord } from "../model/fold.ts";
import { attempt, constellationOf, task } from "./graph.ts";

const LONG = [
  "Migrate the eligibility calculator's household-size table to the shared limits module",
  "Ensure that impersonated planner sessions can never write to production data",
  "Re-run the trace validation against handover.ndjson after the spec's recovery rewrite",
  "Ünïcödé: Überprüfung der Einkommensgrenzen für Haushalte mit mehr als acht Personen",
];

const title = (n: number) => LONG[n % LONG.length] ?? "";

/** A chain of 15 waves in "Pipeline", and four nested levels in "Platform". */
const pipeline = Array.from({ length: 15 }, (_, i) =>
  task({
    id: `P${i + 1}`,
    title: `${i + 1}. ${title(i)}`,
    group: "Pipeline: migrations, checks and the release candidate for Polaris 0.5.0",
    deps: i === 0 ? [] : [`P${i}`],
  })
);

const nested = [
  task({ id: "N", title: "Platform: every surface that runs on a remote Host", group: "Platform" }),
  task({ id: "N1", title: "Daemon over SSH", parent: "N" }),
  task({ id: "N11", title: "Transport", parent: "N1" }),
  task({ id: "N111", title: "Frames and the codec", parent: "N11" }),
  ...["a", "b", "c"].map((s, n) =>
    task({ id: `N111${s}`, title: title(n + 1), parent: "N111", deps: n === 0 ? [] : ["P2"] })
  ),
  task({ id: "N112", title: "Reconnect with backoff and resume", parent: "N11", deps: ["N111"] }),
  task({ id: "N2", title: "Workspaces on a Linux VM", parent: "N", deps: ["N1"] }),
];

/** Slug ids, as Leads sometimes name Tasks. */
const slugs = [
  "email-validator-for-the-signup-form",
  "rate-limiter-middleware",
  "household-income-normaliser",
  "audit-log-retention-policy",
].map((id, n) => task({ id, title: title(n), group: "Slugs", deps: n === 0 ? [] : ["P3"] }));

const loose = Array.from({ length: 44 }, (_, i) =>
  task({ id: `L${i + 1}`, title: title(i), deps: i < 8 ? [] : [`L${i - 7}`] })
);

const gates = Array.from({ length: 8 }, (_, i) =>
  task({
    id: `G${i + 1}`,
    title: `Gate: ${["design", "spec", "bench", "security", "release", "docs", "a11y", "licence"][i] ?? ""} sign-off`,
    kind: "gate",
    deps: i < 4 ? ["P5", "N2"] : [`P${10 + i}`, "L20"],
  })
);

const all: ReadonlyArray<Task> = [...pipeline, ...nested, ...slugs, ...loose, ...gates];

const isLeaf = (t: Task) => !all.some((c) => c.parent === t.id);

const STATES = ["accepted", "working", "review", "failed", "blocked", "waiting"] as const;

type State = (typeof STATES)[number];

const FAILURES = [
  { kind: "implementation", reason: "The checks failed: 3 tests in limits.test.ts" },
  { kind: "transport", reason: "stream closed before the turn ended" },
] as const;

/** The n-th leaf's Attempt in `state`, with the reason a blocked or failed one carries. */
const attemptIn = (taskId: string, state: Exclude<State, "waiting">, n: number) => {
  const spec: Parameters<typeof attempt>[0] = {
    taskId,
    state,
    minutes: 200 - n,
    mergedHead: state === "accepted" ? `c0ffee${n}` : null,
  };

  if (state === "blocked")
    return attempt({ ...spec, blocked: { on: ["P1"], reason: "Waiting for the feed" } });

  if (state === "failed") return attempt({ ...spec, failure: FAILURES[n % 2] ?? FAILURES[0] });

  return attempt(spec);
};

const leaves = all.filter(isLeaf);

/** 80 Tasks in a mix of states. */
const mixed = () =>
  leaves.flatMap((t, n) => {
    const state = STATES[n % STATES.length] ?? "waiting";

    return state === "waiting" ? [] : [attemptIn(t.id, state, n)];
  });

const everyLeaf = (state: "failed" | "accepted") => leaves.map((t, n) => attemptIn(t.id, state, n));

const recordOf = (tasks: ReadonlyArray<Task>, attempts: ReturnType<typeof mixed>, done = false) =>
  startedRecord(
    constellationOf({
      name: "Polaris 0.5.0 release train: migrations, remote Hosts, gates and the break-UI passes",
      revision: 412,
      state: done ? "completed" : "running",
      tasks: [...tasks],
      attempts,
      pendingNotifications: [],
      openQuestions: [],
    }),
    412
  );

export const worstRecords = {
  "worst-one": () =>
    recordOf(
      [task({ id: "A1", title: title(0) })],
      [attempt({ taskId: "A1", state: "working", minutes: 3 })]
    ),
  "worst-80": () => recordOf(all, mixed()),
  "worst-failed": () => recordOf(all, everyLeaf("failed")),
  "worst-accepted": () => recordOf(all, everyLeaf("accepted"), true),
  // The Daemon refuses cycles; a graph that still has one must lay out and stay readable.
  "worst-cycle": () =>
    recordOf(
      [
        task({ id: "C1", title: "Reads the schema", deps: ["C3"] }),
        task({ id: "C2", title: "Writes the migration", deps: ["C1"] }),
        task({ id: "C3", title: "Checks the schema", deps: ["C2"] }),
        task({ id: "C4", title: "Waits on itself", deps: ["C4"] }),
        task({ id: "C5", title: "After the loop", deps: ["C3"] }),
      ],
      [attempt({ taskId: "C1", state: "working", minutes: 4 })]
    ),
} as const;

export type WorstScene = keyof typeof worstRecords;
