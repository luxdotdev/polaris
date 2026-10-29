/** Constellations for the star chart's tests and the constellation gallery (Paper MX-W, MX-X). */
import {
  Attempt,
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  HostId,
  SessionId,
  Task,
  TaskDefinition,
  TaskId,
  TaskProjection,
  WorkspaceId,
} from "@polaris/protocol";
import type { ConstellationSource } from "../model.ts";

export const NOW = Date.parse("2026-10-27T12:00:00Z");

export const task = (id: string, extra: Partial<TaskDefinition> = {}): Task =>
  new Task({
    id: TaskId.make(id),
    title: `Task ${id}`,
    kind: "task",
    brief: "",
    deps: [],
    area: [],
    criteria: [],
    suggested: null,
    group: null,
    parent: null,
    ...extra,
    revision: 0,
    canceled: false,
  });

export const deps = (...ids: ReadonlyArray<string>) => ({ deps: ids.map((id) => TaskId.make(id)) });

export const attempt = (taskId: string, n: number, extra: Partial<Attempt> = {}): Attempt =>
  new Attempt({
    id: AttemptId.make(`${taskId}-a${n}`),
    taskId: TaskId.make(taskId),
    revision: 0,
    cause: AttemptCause.cases.Initial.make({}),
    by: SessionId.make("lead"),
    sessionId: SessionId.make(`${taskId}-worker-${n}`),
    hostId: HostId.make("mac"),
    worktree: `/w/${taskId}`,
    branch: `lucas/${taskId.toLowerCase()}-${n}`,
    base: "main",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: "2026-10-27T11:42:00Z",
    ...extra,
  });

export const projection = (
  taskId: string,
  state: TaskProjection["state"],
  latest: string | null = null
): TaskProjection =>
  new TaskProjection({
    taskId: TaskId.make(taskId),
    state,
    latestAttemptId: latest === null ? null : AttemptId.make(latest),
    blockedBy: [],
    gatePromoted: false,
    stale: false,
    branchFetched: true,
    liveness: null,
  });

export const claim = new Claim({
  branch: "b",
  head: "3f9c2e1a0b",
  commits: [],
  receipts: [CheckReceipt.cases.Reported.make({ label: "tests", text: "ran", exitCode: 0 })],
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "",
});

export const source = (
  tasks: ReadonlyArray<Task>,
  projections: ReadonlyArray<TaskProjection>,
  attempts: ReadonlyArray<Attempt> = [],
  lead: { readonly sessionId: string; readonly hostId: string; readonly since: string } = {
    sessionId: "lead",
    hostId: "mac",
    since: "2026-10-27T10:00:00Z",
  }
): ConstellationSource => ({
  constellation: new Constellation({
    id: ConstellationId.make("c"),
    workspaceId: WorkspaceId.make("w"),
    hostId: HostId.make(lead.hostId),
    leadSessionId: SessionId.make(lead.sessionId),
    name: "Polaris planning",
    state: "running",
    revision: 1,
    settings: new ConstellationSettings({}),
    tasks,
    attempts,
    pendingNotifications: [],
    createdAt: lead.since,
    updatedAt: lead.since,
  }),
  projections,
});

type Code = "d" | "w" | "r" | "b" | "a";

const STATE_OF_CODE: Readonly<Record<Code, TaskProjection["state"]>> = {
  d: "done",
  w: "working",
  r: "review",
  b: "blocked",
  a: "waiting",
};

const ATTEMPT_OF_CODE: Readonly<Record<Exclude<Code, "a">, Attempt["state"]>> = {
  d: "accepted",
  w: "working",
  r: "review",
  b: "blocked",
};

const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString();

const TITLES = [
  "Hosts as instrument rows in Settings",
  "Star chart glyph layer",
  "Review queue with a clean lane",
  "Diffs soft-wrapped with token emphasis",
  "Critical confirmation sheet",
  "Walkthrough sheet",
  "Claim sheet with its checks",
];

const startedAttempt = (id: string, code: Exclude<Code, "a">, i: number, now: number) => {
  const extra: Partial<Attempt> = { state: ATTEMPT_OF_CODE[code], startedAt: ago(now, 18 + i * 7) };

  if (code === "r")
    Object.assign(extra, { claim, claimedAt: ago(now, 6), handedUpAt: ago(now, 5) });

  if (code === "d") Object.assign(extra, { claim, endedAt: ago(now, 40 - i) });

  if (code === "b") Object.assign(extra, { blockedReason: "Waiting for the feed contract" });

  return attempt(id, 1, extra);
};

/** Each band a chain: a task waits on the one before it, so its place is its wave. */
const chained = (bands: ReadonlyArray<readonly [string, ReadonlyArray<Code>]>, now: number) => {
  const tasks: Array<Task> = [];
  const projections: Array<TaskProjection> = [];
  const attempts: Array<Attempt> = [];

  for (const [band, codes] of bands)
    codes.forEach((code, i) => {
      const id = `${band.slice(0, 1)}${i + 1}`;

      const definition: Partial<TaskDefinition> = {
        title: TITLES[(tasks.length * 3) % TITLES.length] ?? id,
        group: band,
      };

      if (i > 0) Object.assign(definition, deps(`${band.slice(0, 1)}${i}`));
      tasks.push(task(id, definition));
      projections.push(projection(id, STATE_OF_CODE[code], code === "a" ? null : `${id}-a1`));

      if (code !== "a") attempts.push(startedAttempt(id, code, i, now));
    });

  return { tasks, projections, attempts };
};

const codes = (text: string): ReadonlyArray<Code> =>
  text.split("").filter((c): c is Code => c in STATE_OF_CODE);

export type GalleryDataset = "header" | "compressed";

/** Paper MX-W (12 tasks, 5 of 12 done) or MX-X (38 tasks, 21 done), led by `sessionId`. */
export const galleryConstellation = (
  dataset: GalleryDataset,
  lead: { readonly sessionId: string; readonly hostId: string },
  now: number
): ConstellationSource => {
  const bands: ReadonlyArray<readonly [string, ReadonlyArray<Code>]> = (
    dataset === "header"
      ? [
          ["Contracts", "dddwa"],
          ["Screens", "ddra"],
          ["QA", "wb"],
        ]
      : [
          ["Alpha", "ddddddwa"],
          ["Beta", "ddddrraa"],
          ["Core", "ddddddwwbaa"],
          ["Duo", "dddddwa"],
          ["Edge", "aaaa"],
        ]
  ).map(([band, text]) => [band, codes(text)] as const);

  const { tasks, projections, attempts } = chained(bands, now);

  if (dataset === "header") {
    tasks.push(task("G1", { title: "Merge phase 2", kind: "gate", ...deps("A5", "B4", "C2") }));
    projections.push(projection("G1", "waiting"));
  }

  return source(tasks, projections, attempts, { ...lead, since: ago(now, 72) });
};
