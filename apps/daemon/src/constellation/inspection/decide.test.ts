import { expect, test } from "bun:test";
import {
  AttemptCause,
  PlanOperation,
  ReviewAction,
  SessionId,
  TaskDefinition,
  WorkerPlacement,
  type DomainEvent,
  type TaskPatch,
} from "@polaris/protocol";
import { Predicate } from "effect";
import {
  A,
  B,
  C,
  CID,
  G,
  LEAD,
  apply,
  claimed,
  ctx,
  dispatched,
  draft,
  foldDecision,
  planned,
  report,
  task,
} from "../../engine/constellation.testing.ts";
import { decideConstellation } from "../../engine/constellation.ts";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { decideConstellationJournal } from "../journal.ts";

const marked = (accept?: boolean) =>
  new TaskDefinition({
    id: A,
    title: A,
    brief: "Build A",
    kind: "task",
    inspect: accept === undefined ? {} : { accept },
  });

const inspected = (accept?: boolean) =>
  claimed(dispatched(planned([marked(accept), task(B, [A])])));

const current = (record: ConstellationRecord) => record.graph.attempts.at(-1)!;

/** What waits for the Lead's next digest: each item's kind, and a settle's state. */
const pendingItems = (record: ConstellationRecord) =>
  record.graph.pendingNotifications.map((n) =>
    Predicate.isTagged(n.item, "Settled") ? `Settled ${n.item.state}` : n.item._tag
  );

const verdict = (
  record: ConstellationRecord,
  patch: {
    verdict?: "approve" | "send_back";
    reason?: string;
    inspectionId?: string;
    sessionId?: SessionId;
  } = {},
  context: Parameters<typeof ctx>[0] = {}
) => {
  const attempt = record.graph.attempts.find((a) => a.id === draft().id)!;

  return decideConstellation(
    record,
    C.Inspect.make({
      constellationId: CID,
      attemptId: attempt.id,
      inspectionId: patch.inspectionId ?? attempt.inspection!.id,
      verdict: patch.verdict ?? "approve",
      reason: patch.reason ?? "Reads right.",
    }),
    ctx({
      binding: { kind: "session", sessionId: patch.sessionId ?? attempt.inspection!.sessionId },
      ...context,
    })
  );
};

const committed = (
  record: ConstellationRecord,
  decision: { events: ReadonlyArray<DomainEvent>; rejection: unknown }
) => {
  expect(decision.rejection).toBeNull();

  return foldDecision(record, decision.events);
};

const codes = (decision: ReturnType<typeof decideConstellation>) =>
  decision.rejection?.findings.map((f) => f.code) ?? [];

test("a Claim on a marked Task starts an Inspection and tells the Lead nothing", () => {
  const record = inspected();
  const attempt = current(record);

  expect(attempt.state).toBe("review");
  expect(attempt.inspection).toMatchObject({ state: "pending", head: "head", accept: false });
  expect(attempt.inspection!.sessionId).not.toBe(attempt.sessionId);
  expect(pendingItems(record)).toEqual([]);
});

test("a Claim on an unmarked Task reaches the Lead at once, with no Inspection", () => {
  const record = claimed();

  expect(current(record).inspection).toBeNull();
  expect(pendingItems(record)).toEqual(["Settled review"]);
});

test("an approval reaches the Lead with the verdict, and the Lead still accepts", () => {
  const record = committed(inspected(), verdict(inspected(), { reason: "Covers the criteria." }));
  const attempt = current(record);

  expect(attempt.state).toBe("review");
  expect(attempt.inspection).toMatchObject({ state: "approved", reason: "Covers the criteria." });
  expect(pendingItems(record)).toEqual(["Settled review"]);

  const accepted = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.Accept.make({ mergedHead: "head", receipts: [] }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );

  expect(current(accepted).state).toBe("accepted");
});

test("an approval under the Accept grant accepts the merged Claim without the Lead", () => {
  const record = committed(
    inspected(true),
    verdict(inspected(true), {}, { inspectorMerge: { refusal: null } })
  );

  expect(current(record)).toMatchObject({
    state: "accepted",
    mergedHead: "head",
    inspection: { state: "accepted" },
  });
  expect(pendingItems(record)).toEqual(["Settled accepted"]);
});

test("a granted Accept whose merge was refused goes to the Lead with the refusal", () => {
  const record = committed(
    inspected(true),
    verdict(inspected(true), {}, { inspectorMerge: { refusal: "The merge conflicts in a.ts" } })
  );

  expect(current(record)).toMatchObject({
    state: "review",
    inspection: { state: "approved", mergeRefusal: "The merge conflicts in a.ts" },
  });
  expect(pendingItems(record)).toEqual(["Settled review"]);
});

test("an approval without the grant never accepts, even when a merge is reported", () => {
  const record = committed(
    inspected(false),
    verdict(inspected(false), {}, { inspectorMerge: { refusal: null } })
  );

  expect(current(record).state).toBe("review");
});

test("a send-back is an ordinary SendBack: the Claim is rejected and the next Attempt starts", () => {
  const before = inspected();

  const next = draft(
    A,
    "a2",
    draft().sessionId,
    AttemptCause.cases.SentBack.make({ ref: draft().id })
  );

  const record = committed(
    before,
    verdict(
      before,
      { verdict: "send_back", reason: "The retry is untested." },
      { attempts: [next] }
    )
  );

  const [first, second] = record.graph.attempts;

  expect(first).toMatchObject({
    state: "rejected",
    rejectedBy: "inspector",
    rejectionReason: "The retry is untested.",
    inspection: { state: "sent_back" },
  });
  expect(second).toMatchObject({ id: next.id, state: "working", cause: next.cause });
  expect(pendingItems(record)).toEqual(["Settled rejected"]);
});

test("a send-back needs a reason and a prepared worker", () => {
  const before = inspected();

  expect(codes(verdict(before, { verdict: "send_back", reason: " " }))).toEqual([
    "E-INSPECTION-REASON",
  ]);
  expect(codes(verdict(before, { verdict: "send_back", reason: "Fix it." }))).toEqual([
    "E-PLACEMENT",
  ]);
});

test("a newer Claim supersedes the Inspection, and the old Inspector's verdict is refused", () => {
  const first = inspected();
  const old = current(first).inspection!;

  const amended = apply(
    first,
    C.WorkerClaim.make({
      constellationId: CID,
      attemptId: draft().id,
      claim: report(draft().branch, "head2"),
    }),
    ctx({
      binding: { kind: "session", sessionId: draft().sessionId },
      claimProbe: { dirtyPaths: [], branch: draft().branch, head: "head2" },
    })
  );

  const fresh = current(amended).inspection!;

  expect(fresh).toMatchObject({ state: "pending", head: "head2" });
  expect(fresh.id).not.toBe(old.id);
  expect(pendingItems(amended)).toEqual([]);
  expect(codes(verdict(amended, { inspectionId: old.id, sessionId: old.sessionId }))).toEqual([
    "E-AUTHORITY",
  ]);
  expect(verdict(amended).rejection).toBeNull();
});

test("a review by the Lead supersedes the pending Inspection and refuses its verdict", () => {
  const before = inspected();
  const attempt = current(before);

  const next = draft(
    A,
    "a2",
    draft().sessionId,
    AttemptCause.cases.SentBack.make({ ref: attempt.id })
  );

  const sentBack = apply(
    before,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "Wrong base.",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: next.sessionId }),
        mergeConflictBase: null,
      }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD }, attempts: [next] })
  );

  expect(sentBack.graph.attempts[0]).toMatchObject({
    state: "rejected",
    rejectedBy: "lead",
    inspection: { state: "superseded" },
  });
  expect(codes(verdict(sentBack))).toEqual(["E-INSPECTION-STALE"]);
});

test("a verdict from any session but the Inspection's own is refused", () => {
  const before = inspected();

  for (const sessionId of [LEAD, draft().sessionId, SessionId.make("stranger")])
    expect(codes(verdict(before, { sessionId }))).toEqual(["E-AUTHORITY"]);

  expect(
    codes(
      decideConstellation(
        before,
        C.Inspect.make({
          constellationId: CID,
          attemptId: draft().id,
          inspectionId: current(before).inspection!.id,
          verdict: "approve",
          reason: "",
        }),
        ctx({ binding: { kind: "user" } })
      )
    )
  ).toEqual(["E-AUTHORITY"]);
});

test("a second verdict on the same Inspection is refused", () => {
  const record = committed(inspected(), verdict(inspected()));

  expect(codes(verdict(record, { verdict: "send_back", reason: "Changed my mind." }))).toEqual([
    "E-INSPECTION-STALE",
  ]);
});

test("a lost Inspector releases the held Claim to the Lead, once", () => {
  const before = inspected();
  const attempt = current(before);

  const lost = decideConstellationJournal(
    before,
    {
      type: "inspectionLost",
      attemptId: attempt.id,
      inspectionId: attempt.inspection!.id,
      reason: "its turn ended without a verdict",
    },
    ctx()
  );

  const record = committed(before, lost);

  expect(current(record)).toMatchObject({ state: "review", inspection: { state: "lost" } });
  expect(pendingItems(record)).toEqual(["Settled review"]);

  const again = decideConstellationJournal(
    record,
    {
      type: "inspectionLost",
      attemptId: attempt.id,
      inspectionId: attempt.inspection!.id,
      reason: "again",
    },
    ctx()
  );

  expect(again).toEqual({ events: [], rejection: null });
});

test("a Gate cannot be marked for Inspection", () => {
  const decision = decideConstellation(
    planned([task(A)]),
    C.Plan.make({
      constellationId: CID,
      operations: [
        PlanOperation.cases.Add.make({
          task: new TaskDefinition({ id: G, title: G, brief: "", kind: "gate", inspect: {} }),
        }),
      ],
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );

  expect(codes(decision)).toEqual(["E-INSPECT-GATE"]);
});

test("an Edit marks, grants and unmarks a Task; an omitted inspect keeps the mark", () => {
  const edit = (record: ConstellationRecord, patch: TaskPatch) =>
    apply(
      record,
      C.Plan.make({
        constellationId: CID,
        operations: [
          PlanOperation.cases.Edit.make({
            taskId: A,
            revision: record.graph.tasks.find((t) => t.id === A)!.revision,
            task: patch,
          }),
        ],
      }),
      ctx({ binding: { kind: "session", sessionId: LEAD } })
    );

  const mark = (record: ConstellationRecord) => record.graph.tasks.find((t) => t.id === A)!.inspect;
  const granted = edit(planned(), { inspect: { accept: true } });

  expect(mark(granted)).toEqual({ accept: true });
  expect(mark(edit(granted, { title: "Renamed" }))).toEqual({ accept: true });
  expect(mark(edit(granted, { inspect: null }))).toBeNull();
  expect(Predicate.isNull(mark(planned()))).toBe(true);
});
