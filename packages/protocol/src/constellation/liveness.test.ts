import { expect, test } from "bun:test";
import { Schema } from "effect";
import { HostId, Sequence, SessionId, TurnId, WorkspaceId } from "../ids.ts";
import {
  AttemptId,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  TaskId,
  TaskProjection,
} from "./domain.ts";
import { WorkerActivity, WorkerLiveness } from "./liveness.ts";
import { ConstellationResult, ConstellationStreamItem } from "./rpc.ts";

const liveness = new WorkerLiveness({
  current: new WorkerActivity({
    itemId: "tool:1",
    turnId: TurnId.make("turn:1"),
    command: "bun run test",
    startedAt: 1_759_360_000_000,
  }),
  lastOutputAt: 1_759_360_001_000,
  contextPercent: 85,
  queuedInput: 2,
});

const projection = new TaskProjection({
  taskId: TaskId.make("A1"),
  state: "working",
  latestAttemptId: AttemptId.make("attempt:1"),
  blockedBy: [],
  gatePromoted: false,
  stale: false,
  branchFetched: true,
  liveness,
});

test("a projection always carries liveness: null when nothing was observed", () => {
  const { liveness: _liveness, ...rest } = Schema.encodeSync(TaskProjection)(projection);

  expect(() => Schema.decodeUnknownSync(TaskProjection)(rest)).toThrow();
  expect(Schema.decodeUnknownSync(TaskProjection)({ ...rest, liveness: null }).liveness).toBeNull();
});

test("status and subscribe Snapshot carry the latest Attempt's liveness", () => {
  const constellation = new Constellation({
    id: ConstellationId.make("c"),
    workspaceId: WorkspaceId.make("w"),
    hostId: HostId.make("h"),
    leadSessionId: SessionId.make("lead"),
    name: "Build",
    state: "running",
    revision: 1,
    settings: new ConstellationSettings({}),
    tasks: [],
    attempts: [],
    pendingNotifications: [],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  });

  const result = new ConstellationResult({
    summary: "Working",
    next: "Review the Claim.",
    revision: 1,
    sequence: Sequence.make(1),
    constellation,
    projections: [projection],
  });

  const snapshot = ConstellationStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(1),
    constellation,
    projections: [projection],
    proposals: [],
    progress: [],
    messages: [],
    digests: [],
    handovers: [],
  });

  const decodeResult = Schema.decodeUnknownSync(Schema.fromJsonString(ConstellationResult));

  const decodeSnapshot = Schema.decodeUnknownSync(
    Schema.fromJsonString(ConstellationStreamItem.cases.Snapshot)
  );

  expect(decodeResult(JSON.stringify(result)).projections[0]?.liveness).toEqual(liveness);
  expect(decodeSnapshot(JSON.stringify(snapshot)).projections[0]?.liveness).toEqual(liveness);
});

test("live liveness is keyed by Attempt with no graph revision or stream sequence", () => {
  const update = ConstellationStreamItem.cases.LivenessChanged.make({
    attemptId: AttemptId.make("attempt:1"),
    liveness,
  });

  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ConstellationStreamItem));

  expect(decode(JSON.stringify(update))).toEqual(update);
  expect(update).not.toHaveProperty("sequence");
  expect(update).not.toHaveProperty("revision");
});

test("unknown context/output remain null and invalid observed counters are rejected", () => {
  const unknown = { current: null, lastOutputAt: null, contextPercent: null, queuedInput: 0 };
  const decode = Schema.decodeUnknownSync(WorkerLiveness);

  expect(decode(unknown)).toEqual(unknown);
  expect(() => decode({ ...unknown, queuedInput: -1 })).toThrow();
  expect(() => decode({ ...unknown, contextPercent: 101 })).toThrow();
  expect(() => decode({ ...unknown, lastOutputAt: -1 })).toThrow();
});
