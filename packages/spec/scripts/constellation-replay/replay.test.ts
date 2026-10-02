import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  Attempt,
  AttemptCause,
  AttemptId,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationNotification,
  ConstellationSettings,
  HostResource,
  NotificationItem,
  ResourceLease,
  Task,
  TaskId,
} from "../../../protocol/src/constellation/domain.ts";
import { DomainEvent } from "../../../protocol/src/events.ts";
import { HostId, SessionId, TurnId, WorkspaceId } from "../../../protocol/src/ids.ts";
import {
  constellationTraceToQuint,
  ConstellationTrace,
  decodeConstellationTrace,
  ResourceLeaseCanceled,
  ResourceRemoved,
} from "./index.ts";

const host = HostId.make("lead-host");

const lead = SessionId.make("lead");

const worker = SessionId.make("worker");

const constellationId = ConstellationId.make("graph");

const attemptId = AttemptId.make("attempt");

const E = DomainEvent.cases;

const time = "2026-10-01T00:00:00Z";

const graph = { constellationId, revision: 1 };

const target = { ...graph, attemptId, attemptRevision: 2 };

const claim = new Claim({
  branch: "polaris/graph/A",
  head: "head-1",
  commits: ["head-1"],
  receipts: [],
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "Done",
});

const started = E.ConstellationStarted.make({
  ...graph,
  constellation: new Constellation({
    id: constellationId,
    workspaceId: WorkspaceId.make("workspace"),
    hostId: host,
    leadSessionId: lead,
    name: "Graph",
    state: "planning",
    revision: 0,
    settings: new ConstellationSettings({}),
    tasks: [],
    attempts: [],
    pendingNotifications: [],
    createdAt: time,
    updatedAt: time,
  }),
});

const task = new Task({
  id: TaskId.make("A"),
  title: "A",
  brief: "Build A",
  kind: "task",
  revision: 1,
  canceled: false,
});

const gate = new Task({
  id: TaskId.make("G"),
  title: "G",
  brief: "Verify A",
  kind: "gate",
  deps: [task.id],
  revision: 1,
  canceled: false,
});

const began = E.AttemptStarted.make({
  ...graph,
  attempt: new Attempt({
    id: attemptId,
    taskId: task.id,
    revision: 1,
    cause: AttemptCause.cases.Initial.make({}),
    by: lead,
    sessionId: worker,
    hostId: host,
    worktree: "/temp/A",
    branch: claim.branch,
    base: "base",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: time,
  }),
});

const notification = (id: string, state: "review" | "lost") =>
  E.NotificationQueued.make({
    ...graph,
    notification: new ConstellationNotification({
      id,
      queuedAt: time,
      item: NotificationItem.cases.Settled.make({ attemptId, state }),
    }),
  });

const initial = [
  started,
  E.TaskDeclared.make({ ...graph, task }),
  E.TaskDeclared.make({ ...graph, task: gate }),
  E.ConstellationStateChanged.make({ ...graph, state: "running" }),
];

const reviewed = [began, E.AttemptClaimed.make({ ...target, claim }), notification("n", "review")];

const accepted = [
  E.AttemptAccepted.make({ ...target, mergedHead: claim.head, receipts: [], evidence: "asserted" }),
  E.GatePromoted.make({ ...graph, taskId: gate.id, taskRevision: 1 }),
  E.LeadNotified.make({
    ...graph,
    leadSessionId: lead,
    items: ["n"],
    turnId: TurnId.make("digest"),
  }),
];

const batch = (events: ReadonlyArray<DomainEvent>) => ({ hostId: host, events });

const trace = (batches: ConstellationTrace["batches"]): ConstellationTrace => ({
  version: 1,
  ownerHostId: host,
  batches,
});

const check = (input: ConstellationTrace): boolean => {
  const spec = join(import.meta.dir, "../..");
  const root = mkdtempSync(join(tmpdir(), "polaris-replay-test-"));

  try {
    const sources = constellationTraceToQuint(
      "check",
      input,
      relative(root, join(spec, "constellations"))
    );

    return sources.every((source) => {
      const path = join(root, `${source.name}.qnt`);
      writeFileSync(path, source.source);

      const checked = Bun.spawnSync(
        [
          join(spec, "node_modules/.bin/quint"),
          "test",
          path,
          `--main=${source.name}`,
          "--backend=typescript",
        ],
        { stdout: "pipe", stderr: "pipe" }
      );

      return checked.exitCode === 0;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("Constellation real-log replay", () => {
  test("protocol events replay Claims, acceptance, Gate promotion and digest delivery", () => {
    expect(check(trace([batch(initial), batch(reviewed), batch(accepted)]))).toBe(true);
  });

  test("JSON boundary and CLI replay the complete log", () => {
    const encoded = Schema.encodeSync(
      Schema.fromJsonString(Schema.toCodecJson(ConstellationTrace))
    )(trace([batch(initial), batch(reviewed), batch(accepted)]));

    expect(check(decodeConstellationTrace(encoded))).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "polaris-replay-cli-"));

    try {
      const file = join(dir, "trace.json");
      writeFileSync(file, encoded);

      const result = Bun.spawnSync(
        ["bun", join(import.meta.dir, "../replay-constellation.ts"), file],
        { stdout: "pipe", stderr: "pipe" }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("1/1 traces conform");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("complete graph history and unique start are required", () => {
    expect(() =>
      constellationTraceToQuint("bad", trace([batch(initial.slice(1))]), "model")
    ).toThrow("earlier ConstellationStarted");
    expect(() =>
      constellationTraceToQuint("bad", trace([batch(initial), batch([started])]), "model")
    ).toThrow("repeated");
  });

  test("refused remote intents can commit empty owner receipt batches", () => {
    const receipt = { hostId: host, events: [], outboxId: "refused", constellationId };
    expect(check(trace([batch(initial), receipt]))).toBe(true);
    expect(check(trace([batch(initial), receipt, receipt]))).toBe(false);
  });

  test("a mismatched merged head is rejected by the reference model", () => {
    const wrong = E.AttemptAccepted.make({
      ...target,
      mergedHead: "wrong-head",
      receipts: [],
      evidence: "asserted",
    });

    expect(
      check(trace([batch(initial), batch(reviewed), batch([wrong, ...accepted.slice(1)])]))
    ).toBe(false);
  });

  test("repeated delivery and delivery to the previous Lead are rejected", () => {
    const delivered = E.LeadNotified.make({
      ...graph,
      leadSessionId: lead,
      items: ["n"],
      turnId: TurnId.make("digest"),
    });

    expect(
      check(trace([batch(initial), batch(reviewed), batch(accepted), batch([delivered])]))
    ).toBe(false);

    const handover = E.LeadChanged.make({
      ...graph,
      from: lead,
      to: SessionId.make("next-lead"),
      summary: "Continue",
    });

    expect(check(trace([batch(initial), batch(reviewed), batch([handover, delivered])]))).toBe(
      false
    );
  });

  test("ownership is checked even for metadata omitted from the abstraction", () => {
    const message = E.PeerMessage.make({ ...graph, from: attemptId, to: attemptId, text: "Hello" });
    expect(() =>
      constellationTraceToQuint(
        "bad",
        trace([{ hostId: "foreign-host", events: [message] }]),
        "model"
      )
    ).toThrow("owner");
  });

  test("stale settlement requires explicit context and cannot be mechanical", () => {
    const settled = E.AttemptSettled.make({
      ...target,
      outcome: "lost",
      reason: "Host is Offline",
    });

    const events = [settled, notification("lost", "lost")];
    expect(() =>
      constellationTraceToQuint(
        "bad",
        trace([batch(initial), batch([began]), batch(events)]),
        "model"
      )
    ).toThrow("batch.context");
    const context = { offlineSessionIds: [worker], commanded: true };
    expect(check(trace([batch(initial), batch([began]), { ...batch(events), context }]))).toBe(
      true
    );
    expect(
      check(
        trace([
          batch(initial),
          batch([began]),
          { ...batch(events), context: { ...context, commanded: false } },
        ])
      )
    ).toBe(false);
  });

  test("remote receipt reapplication is rejected", () => {
    expect(check(trace([batch(initial), { ...batch(reviewed), outboxId: "remote:1" }]))).toBe(true);
    expect(
      check(
        trace([
          batch(initial),
          { ...batch(reviewed), outboxId: "remote:1" },
          {
            ...batch([E.OperatorMessageResolved.make({ ...graph, id: "m" })]),
            outboxId: "remote:1",
          },
        ])
      )
    ).toBe(false);
  });

  test("Host resource streams use their own owner and capacity", () => {
    const remote = HostId.make("worker-host");
    const resource = new HostResource({ hostId: remote, name: "bench", capacity: 1 });

    const queued = (id: string) =>
      E.ResourceLeaseQueued.make({ hostId: remote, resource: resource.name, requestId: id });

    const leased = (id: string) =>
      E.ResourceLeased.make({
        lease: new ResourceLease({
          id,
          hostId: remote,
          resource: resource.name,
          command: ["bun", "run", "bench"],
          processId: 123,
          acquiredAt: time,
        }),
      });

    const events = [
      E.ResourceDeclared.make({ resource }),
      queued("r1"),
      queued("r2"),
      leased("r1"),
    ];

    expect(check(trace([{ hostId: remote, events }]))).toBe(true);

    const cancel = ResourceLeaseCanceled.make({
      hostId: remote,
      resource: resource.name,
      requestId: "r2",
      reason: "Requester exited",
    });

    const removed = ResourceRemoved.make({ hostId: remote, resource: resource.name });

    const released = E.ResourceReleased.make({
      hostId: remote,
      resource: resource.name,
      leaseId: "r1",
      reason: "Process exited",
    });

    expect(check(trace([{ hostId: remote, events: [...events, cancel, released, removed] }]))).toBe(
      true
    );
    expect(check(trace([{ hostId: remote, events: [...events, removed] }]))).toBe(false);
    expect(check(trace([{ hostId: remote, events: [...events, leased("r2")] }]))).toBe(false);
    expect(
      check(
        trace([{ hostId: remote, events: [events[0]!, queued("r1"), queued("r2"), leased("r2")] }])
      )
    ).toBe(false);
  }, 20_000);
});
