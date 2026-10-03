import { describe, expect, test } from "bun:test";
import { Schema, Struct } from "effect";
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
import { MessageTarget } from "../../../protocol/src/constellation/commands.ts";
import { DomainEvent } from "../../../protocol/src/events.ts";
import { Turn } from "../../../protocol/src/domain.ts";
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

const unblockFixture = () => {
  const blocked = E.AttemptBlocked.make({
    ...target,
    on: [],
    reason: "Waiting for the Lead",
    at: time,
  });

  const unblocked = E.AttemptUnblocked.make({ ...target, cause: "Lead", at: time });

  const delivered = E.WorkerInputDelivered.make({
    ...graph,
    id: "message",
    sessionId: worker,
    at: time,
  });

  const turn = new Turn({
    id: TurnId.make(JSON.stringify([delivered.id, worker])),
    sessionId: worker,
    index: 1,
    prompt: "Continue A",
    attachments: [],
    model: null,
    effort: null,
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: time,
    endedAt: null,
  });

  const message = E.OperatorMessageSent.make({
    ...graph,
    revision: blocked.revision + 1,
    id: delivered.id,
    authority: "conversation",
    target: MessageTarget.cases.Worker.make({ attemptId }),
    text: "Continue A",
    questionId: null,
  });

  return { blocked, unblocked, delivered, message, turn: E.TurnStarted.make({ turn }) };
};

test("local unblock replay requires a worker Turn in the same committed batch", () => {
  const f = unblockFixture();

  const source = (events: DomainEvent[]) =>
    constellationTraceToQuint(
      "block",
      trace([batch(initial), batch([began, f.blocked]), batch([f.message]), batch(events)]),
      "constellations"
    )[0]!.source;

  expect(source([f.unblocked, f.delivered])).toContain('cause: "Lead", turn: false');
  expect(source([f.turn, f.unblocked, f.delivered])).toContain('cause: "Lead", turn: true');
});

test("remote unblock replay requires the exact earlier worker Host Turn and owner receipt", () => {
  const f = unblockFixture();
  const remote = HostId.make("remote");

  const remoteBegan = E.AttemptStarted.make({
    ...began,
    attempt: new Attempt(Struct.assign(began.attempt, { hostId: remote })),
  });

  const source = (remoteBatch: ConstellationTrace["batches"][number], receipts: DomainEvent[]) =>
    constellationTraceToQuint(
      "remote_block",
      trace([
        batch(initial),
        batch([remoteBegan, f.blocked]),
        batch([f.message]),
        remoteBatch,
        batch([f.unblocked, ...receipts]),
      ]),
      "constellations"
    )[0]!.source;

  expect(source({ hostId: remote, events: [f.turn] }, [f.delivered])).toContain(
    'cause: "Lead", turn: true'
  );
  expect(source({ hostId: HostId.make("other-host"), events: [f.turn] }, [f.delivered])).toContain(
    'cause: "Lead", turn: false'
  );
  expect(source({ hostId: remote, events: [f.turn] }, [])).toContain('cause: "Lead", turn: false');
  expect(
    source(
      {
        hostId: remote,
        events: [
          E.TurnStarted.make({
            turn: new Turn(Struct.assign(f.turn.turn, { id: TurnId.make("another-input") })),
          }),
        ],
      },
      [f.delivered]
    )
  ).toContain('cause: "Lead", turn: false');
});

describe("Constellation real-log replay", () => {
  test("protocol events replay Claims, acceptance, Gate promotion and digest delivery", () => {
    expect(check(trace([batch(initial), batch(reviewed), batch(accepted)]))).toBe(true);
  }, 30_000);

  test("JSON boundary and CLI replay a representative log", () => {
    const input = trace([batch(initial)]);

    const encoded = Schema.encodeSync(
      Schema.fromJsonString(Schema.toCodecJson(ConstellationTrace))
    )(input);

    // Claims, Gate and delivery replay above; the CLI smoke needs only one Quint subprocess.
    expect(decodeConstellationTrace(encoded)).toEqual(input);
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
  }, 30_000);

  test("complete graph history and unique start are required", () => {
    expect(() =>
      constellationTraceToQuint("bad", trace([batch(initial.slice(1))]), "model")
    ).toThrow("earlier ConstellationStarted");
    expect(() =>
      constellationTraceToQuint("bad", trace([batch(initial), batch([started])]), "model")
    ).toThrow("repeated");
  }, 30_000);

  test("refused remote intents can commit empty owner receipt batches", () => {
    const receipt = { hostId: host, events: [], outboxId: "refused", constellationId };
    expect(check(trace([batch(initial), receipt]))).toBe(true);
    expect(check(trace([batch(initial), receipt, receipt]))).toBe(false);
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

  test("handover requests replay in order; cancelled or superseded completions are rejected", () => {
    const request = (id: string) =>
      E.LeadHandoverRequested.make({
        ...graph,
        requestId: id,
        from: lead,
        summary: "",
        interrupt: false,
      });

    const changed = (id: string) =>
      E.LeadChanged.make({
        ...graph,
        requestId: id,
        from: lead,
        to: SessionId.make("next-lead"),
        summary: "Continue",
      });

    const cancelled = E.LeadHandoverCancelled.make({
      ...graph,
      requestId: "r1",
      reason: "Archived",
    });

    expect(check(trace([batch(initial), batch([request("r1")]), batch([changed("r1")])]))).toBe(
      true
    );
    expect(
      check(trace([batch(initial), batch([request("r1"), cancelled]), batch([changed("r1")])]))
    ).toBe(false);
    expect(
      check(trace([batch(initial), batch([request("r1"), request("r2")]), batch([changed("r1")])]))
    ).toBe(false);
    expect(
      check(trace([batch(initial), batch([request("r1"), request("r2")]), batch([changed("r2")])]))
    ).toBe(true);
  }, 30_000);

  test("stale intervals and per-recipient input receipts replay without an Attempt revision bump", () => {
    const stale = E.AttemptStale.make({ ...graph, attemptId, hostId: host, at: time });
    const fresh = E.AttemptFresh.make({ ...graph, attemptId, at: time });

    const delivered = E.WorkerInputDelivered.make({
      ...graph,
      id: "message",
      sessionId: worker,
      at: time,
    });

    expect(check(trace([batch(initial), batch([began]), batch([stale, fresh, delivered])]))).toBe(
      true
    );
    expect(check(trace([batch(initial), batch([began]), batch([delivered, delivered])]))).toBe(
      false
    );
  }, 30_000);

  test("ownership is checked even for metadata omitted from the abstraction", () => {
    const message = E.PeerMessage.make({ ...graph, from: attemptId, to: attemptId, text: "Hello" });
    expect(() =>
      constellationTraceToQuint(
        "bad",
        trace([{ hostId: "foreign-host", events: [message] }]),
        "model"
      )
    ).toThrow("owner");
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);
});

test("recovery replay requires eligible proof for the exact interruption ID", () => {
  const proof = E.AttemptInterrupted.make({
    ...graph,
    attemptId,
    turnId: TurnId.make("interrupted"),
    interruptionId: "cut-1",
    eligible: true,
    at: time,
  });

  const recovered = E.AttemptRecoveryContinued.make({
    ...target,
    turnId: TurnId.make("continued"),
    interruptionId: "cut-1",
    cause: "recover",
  });

  expect(check(trace([batch([...initial, began]), batch([proof]), batch([recovered])]))).toBe(true);
  expect(check(trace([batch([...initial, began]), batch([recovered])]))).toBe(false);
  expect(
    check(
      trace([
        batch([...initial, began]),
        batch([E.AttemptInterrupted.make({ ...proof, eligible: false })]),
        batch([recovered]),
      ])
    )
  ).toBe(false);
  expect(
    check(
      trace([
        batch([...initial, began]),
        batch([proof]),
        batch([E.AttemptRecoveryContinued.make({ ...recovered, interruptionId: "cut-2" })]),
      ])
    )
  ).toBe(false);
}, 30_000);

test("unblock replay requires a Lead input sent after the block", () => {
  const f = unblockFixture();

  const source = (before: boolean) =>
    constellationTraceToQuint(
      "fresh_block",
      trace([
        batch(initial),
        batch([began]),
        ...(before
          ? [batch([E.OperatorMessageSent.make({ ...f.message, revision: 1 })]), batch([f.blocked])]
          : [batch([f.blocked]), batch([f.message])]),
        batch([f.turn, f.unblocked, f.delivered]),
      ]),
      "constellations"
    )[0]!.source;

  expect(source(true)).toContain('cause: "Lead", turn: true, fresh: false');
  expect(source(false)).toContain('cause: "Lead", turn: true, fresh: true');
});

test("quoted multiline feedback and merge base replay safely; actual first Turns reject duplicates", () => {
  const reason = 'Keep "both tests".\n\nUnicode λ and \\ literal escape.';

  const retry = E.AttemptStarted.make({
    ...graph,
    attempt: Attempt.make(
      Struct.assign(began.attempt, {
        id: AttemptId.make("retry"),
        hostId: HostId.make("remote-worker"),
        cause: AttemptCause.cases.MergeConflict.make({ ref: attemptId, base: 'base"\nmerge' }),
      })
    ),
  });

  const rejected = E.AttemptRejected.make({ ...target, reason });

  const first = E.TurnStarted.make({
    turn: Turn.make({
      id: TurnId.make("retry:start"),
      sessionId: worker,
      index: 0,
      prompt: reason,
      attachments: [],
      model: null,
      effort: null,
      status: "working",
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: time,
      endedAt: null,
    }),
  });

  const batches = [
    batch(initial),
    batch(reviewed),
    batch([rejected, retry]),
    { hostId: "remote-worker", events: [first] },
  ];

  expect(check(trace(batches))).toBe(true);
  expect(check(trace([...batches, batches.at(-1)!]))).toBe(false);
  expect(() => check(trace([...batches.slice(0, -1), batch([first])]))).toThrow("worker Host");
  const sources = constellationTraceToQuint("first", trace(batches), "model");
  expect(sources[0]!.source).toContain("FirstTurnStarted(1)");
}, 30000);
