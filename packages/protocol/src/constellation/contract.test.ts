import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { DomainEvent, EventEnvelope, StreamKey } from "../events.ts";
import { HostId, Sequence, SessionId, TurnId } from "../ids.ts";
import { CapabilityList } from "../capabilities.ts";
import { DaemonRpcs, HostStreamItem } from "../rpc.ts";
import { ConstellationCommand, PlanOperation, ReviewAction } from "./commands.ts";
import {
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  ConstellationId,
  ConstellationSettings,
  HostResource,
  Revision,
  TaskDefinition,
} from "./domain.ts";
import { ConstellationEvent, ConstellationOutboxEntry, ResourceEvent } from "./events.ts";
import {
  ConstellationPlan,
  ConstellationReview,
  ConstellationRpcs,
  ConstellationWorkerProgress,
} from "./rpc.ts";

const claim = Schema.decodeUnknownSync(Claim)({
  branch: "polaris/c/A1",
  head: "abc123",
  commits: ["abc123"],
  receipts: [],
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "Implemented A1",
});

const roundTrip = <
  S extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
>(
  schema: S,
  value: S["Type"]
) => {
  const codec = Schema.toCodecJson(schema);

  return Schema.decodeUnknownSync(Schema.fromJsonString(codec))(
    JSON.stringify(Schema.encodeSync(codec)(value))
  );
};

describe("Constellation contract", () => {
  test("the subgroup is mounted under DaemonRpcs with no role supplied by the caller", () => {
    expect(ConstellationRpcs.requests.size).toBe(15);

    for (const [tag, rpc] of ConstellationRpcs.requests) {
      expect(DaemonRpcs.requests.get(tag)).toBe(rpc);
    }

    const plan = Schema.decodeUnknownSync(ConstellationPlan.payloadSchema)({
      commandId: "cmd",
      constellationId: "c",
      operations: [],
    });

    expect(plan).toMatchObject({ resources: [] });
    expect(Object.keys(plan)).not.toContain("role");
    expect(Object.keys(plan)).not.toContain("_tag");
  });

  test("review, cancel and edit require revisions; progress does not", () => {
    expect(() =>
      Schema.decodeUnknownSync(ConstellationReview.payloadSchema)({
        commandId: "cmd",
        constellationId: "c",
        attemptId: "a",
        action: ReviewAction.cases.Stop.make({ reason: "Lost" }),
      })
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(PlanOperation.cases.Cancel)({ taskId: "A1" })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PlanOperation.cases.Edit)({ taskId: "A1", task: {} })
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(ConstellationWorkerProgress.payloadSchema)({
        commandId: "cmd",
        constellationId: "c",
        attemptId: "a",
        note: "Checking",
      })
    ).toMatchObject({ completed: null, total: null });

    for (const invalid of [-1, 1.5]) expect(() => Revision.make(invalid)).toThrow();
  });

  test("the full Claim report round-trips and cannot omit receipts or questions", () => {
    expect(roundTrip(Claim, claim)).toEqual(claim);
    const { receipts: _receipts, ...incomplete } = claim;
    expect(() => Schema.decodeUnknownSync(Claim)(incomplete)).toThrow();
    const { questions: _questions, ...withoutQuestions } = claim;
    expect(() => Schema.decodeUnknownSync(Claim)(withoutQuestions)).toThrow();
  });

  test("verified evidence points to a recorded item, while reported evidence is text", () => {
    const verified = CheckReceipt.cases.Verified.make({
      label: "tests",
      item: {
        hostId: HostId.make("h"),
        sessionId: SessionId.make("s"),
        turnId: TurnId.make("t"),
        itemId: "tool:1",
      },
    });

    expect(roundTrip(CheckReceipt, verified)).toEqual(verified);
    expect(() =>
      Schema.decodeUnknownSync(CheckReceipt.cases.Verified)({ label: "tests", text: "passed" })
    ).toThrow();
    expect(
      roundTrip(CheckReceipt, CheckReceipt.cases.Reported.make({ label: "tests", text: "passed" }))
    ).toMatchObject({ exitCode: null });
  });

  test("every Constellation and resource tag belongs to the persisted DomainEvent codec", () => {
    for (const tag of [
      ...Object.keys(ConstellationEvent.cases),
      ...Object.keys(ResourceEvent.cases),
    ]) {
      expect(Object.keys(DomainEvent.cases)).toContain(tag);
    }

    const event = DomainEvent.cases.AttemptClaimed.make({
      constellationId: ConstellationId.make("c"),
      revision: 3,
      attemptId: AttemptId.make("a"),
      attemptRevision: 2,
      claim,
    });

    const envelope = new EventEnvelope({
      sequence: Sequence.make(10),
      occurredAt: "2026-10-01T00:00:00Z",
      commandId: null,
      event,
    });

    expect(roundTrip(EventEnvelope, envelope)).toEqual(envelope);
    expect(
      roundTrip(
        StreamKey,
        StreamKey.cases.constellation.make({ constellationId: ConstellationId.make("c") })
      )
    ).toMatchObject({ constellationId: "c" });
  });

  test("old Host snapshots decode without Constellations; old peers drop the capability", () => {
    expect(
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(HostStreamItem)))(
        '{"_tag":"Snapshot","sequence":0,"workspaces":[],"worktrees":[],"sessions":[]}'
      )
    ).toMatchObject({ sessions: [] });
    expect(
      Schema.decodeUnknownSync(CapabilityList)([
        "constellation",
        "host.resources",
        "future.unknown",
      ])
    ).toEqual(["constellation", "host.resources"]);
    expect(
      Schema.decodeUnknownSync(TaskDefinition)({
        id: "A1",
        title: "Protocol",
        kind: "task",
        brief: "Build",
      })
    ).toMatchObject({ deps: [], area: [], criteria: [], suggested: null });
    expect(Schema.decodeUnknownSync(ConstellationSettings)({})).toMatchObject({ defaults: null });
  });

  test("remote outboxes carry only worker commands and preserve stable ids", () => {
    const entry = new ConstellationOutboxEntry({
      id: "outbox:1",
      constellationId: ConstellationId.make("c"),
      ownerHostId: HostId.make("lead-host"),
      workerHostId: HostId.make("worker-host"),
      sessionId: SessionId.make("worker"),
      attemptId: AttemptId.make("a"),
      command: ConstellationCommand.cases.WorkerClaim.make({
        constellationId: ConstellationId.make("c"),
        attemptId: AttemptId.make("a"),
        claim,
      }),
    });

    expect(roundTrip(ConstellationOutboxEntry, entry)).toEqual(entry);
    expect(() =>
      Schema.decodeUnknownSync(ConstellationOutboxEntry)({
        ...Schema.encodeSync(ConstellationOutboxEntry)(entry),
        command: ConstellationCommand.cases.Plan.make({
          constellationId: ConstellationId.make("c"),
          operations: [],
        }),
      })
    ).toThrow();
  });

  test("linked causes carry the earlier Attempt, merge conflicts also carry their base", () => {
    expect(
      roundTrip(
        AttemptCause,
        AttemptCause.cases.MergeConflict.make({ ref: AttemptId.make("old"), base: "abc" })
      )
    ).toMatchObject({ ref: "old", base: "abc" });
    expect(() => Schema.decodeUnknownSync(AttemptCause.cases.SentBack)({})).toThrow();
    expect(() =>
      HostResource.make({ hostId: HostId.make("h"), name: "bench", capacity: 0 })
    ).toThrow();
  });
});
