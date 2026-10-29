/**
 * Paper MX-AG's constellation: twelve tasks over four bands and four waves, B3's claim handed to
 * you and C3's waiting too. The span's tests read it, and `-polarisDevSpan paper` shows it.
 */
import {
  Attempt,
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  HarnessSelection,
  HostId,
  SessionId,
  Task,
  TaskId,
  TaskProjection,
  WorkspaceId,
} from "@polaris/protocol";
import type { ConstellationSource } from "../constellation/model.ts";

/** B3's claim, as MX-AG's pane shows it. */
export const B3_SUMMARY =
  "Hosts render as instrument rows with round trip, route and connection state. Reconnecting and offline hosts sort first.";

const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString();

const BANDS = {
  A: "settings",
  B: "hosts",
  C: "review",
  D: "duo",
} as const satisfies Record<string, string>;

const TASKS: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
  ["A1", "Theme tokens on mobile", []],
  ["B1", "Connection State dots", []],
  ["A2", "Appearance cards", ["A1"]],
  ["B2", "Host details sheet", ["A1", "B1"]],
  ["C2", "Review queue hero", []],
  ["A3", "Motion row", ["A2"]],
  ["B3", "Hosts as instrument rows in Settings", ["B2"]],
  ["C3", "Findings pager", ["B2"]],
  ["D3", "Monitor on the horizon", ["C2"]],
  ["A4", "Settings merged", ["A3", "B3"]],
  ["C4", "Review merged", ["C3"]],
  ["D4", "Duo merged", ["D3"]],
];

const STATES = {
  A1: "done",
  B1: "done",
  A2: "done",
  B2: "done",
  C2: "done",
  A3: "working",
  B3: "review",
  C3: "review",
  D3: "working",
} as const satisfies Record<string, TaskProjection["state"]>;

const bandOf = (id: string): string | null =>
  Object.entries(BANDS).find(([letter]) => id.startsWith(letter))?.[1] ?? null;

const stateOf = (id: string): TaskProjection["state"] | null =>
  Object.entries(STATES).find(([task]) => task === id)?.[1] ?? null;

const task = ([id, title, deps]: (typeof TASKS)[number]) =>
  new Task({
    id: TaskId.make(id),
    title,
    kind: id.endsWith("4") ? "gate" : "task",
    brief: "",
    deps: deps.map((d) => TaskId.make(d)),
    area: [],
    criteria: [],
    suggested: new HarnessSelection({ harness: id === "B3" ? "codex" : "claude" }),
    group: bandOf(id),
    parent: null,
    revision: 0,
    canceled: false,
  });

const passed = (label: string) =>
  CheckReceipt.cases.Reported.make({ label, text: "ok", command: label, exitCode: 0 });

const claim = (summary: string) =>
  new Claim({
    branch: "lucas/eng-559-hosts",
    head: "4c19e2a7d0b1",
    commits: ["4c19e2a7d0b1", "9a01f3c2b7e4", "d2e8c1a0f5b6", "71b0c4e2a9d3"],
    receipts: [passed("bun run typecheck"), passed("bun test apps/mobile"), passed("bun run lint")],
    notDone: [],
    followups: [],
    questions: [],
    outsideArea: [],
    decisions: [],
    summary,
  });

const attempt = (id: string, now: number, extra: Partial<Attempt>) =>
  new Attempt({
    id: AttemptId.make(`${id}-a${extra.revision ?? 1}`),
    taskId: TaskId.make(id),
    revision: 1,
    cause: AttemptCause.cases.Initial.make({}),
    by: SessionId.make("lead"),
    sessionId: SessionId.make(`${id}-worker`),
    hostId: HostId.make("mac-studio"),
    worktree: `/w/${id}`,
    branch: id,
    base: "main",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: ago(now, 60),
    ...extra,
  });

const handed = (id: string, now: number, summary: string, revision: number) =>
  attempt(id, now, {
    revision,
    state: "review",
    claimedAt: ago(now, 18),
    handedUpAt: ago(now, 12),
    claim: claim(summary),
  });

/** `lostLast` lists B3's lost first attempt after its handed one, as a Host may order them. */
export const paperSpan = (now: number, lostLast = false): ConstellationSource => {
  const lost = attempt("B3", now, { revision: 0, state: "lost" });

  const attempts = [
    ...(lostLast ? [] : [lost]),
    handed("B3", now, B3_SUMMARY, 2),
    handed("C3", now, "The findings pager moves between findings, tinted by severity.", 1),
    ...["A3", "D3"].map((id) => attempt(id, now, {})),
    ...(lostLast ? [lost] : []),
  ];

  const latest = new Map(attempts.map((a) => [String(a.taskId), a.id]));

  const constellation = new Constellation({
    id: ConstellationId.make("paper"),
    workspaceId: WorkspaceId.make("polaris"),
    hostId: HostId.make("mac-studio"),
    leadSessionId: SessionId.make("lead"),
    name: "Hosts in Settings",
    state: "running",
    revision: 12,
    settings: new ConstellationSettings({}),
    tasks: TASKS.map(task),
    attempts,
    pendingNotifications: [],
    createdAt: ago(now, 72),
    updatedAt: ago(now, 12),
  });

  const projections = TASKS.map(
    ([id, , deps]) =>
      new TaskProjection({
        taskId: TaskId.make(id),
        state: stateOf(id) ?? "waiting",
        latestAttemptId: latest.get(id) ?? null,
        blockedBy: stateOf(id) === null ? deps.map((d) => TaskId.make(d)) : [],
        gatePromoted: false,
        stale: false,
        branchFetched: true,
        liveness: null,
      })
  );

  return { constellation, projections };
};
