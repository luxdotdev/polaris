import { expect, test } from "bun:test";
import {
  AttemptCause,
  type ConstellationCommand,
  PlanOperation,
  Sequence,
  TaskDefinition,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { decideConstellation } from "../../engine/constellation.ts";
import type { ConstellationContext } from "../../engine/constellation.inputs.ts";
import {
  A,
  C,
  CID,
  LEAD,
  WS,
  ctx,
  draft,
  foldDecision,
  report,
} from "../../engine/constellation.testing.ts";
import { type ConstellationRecord, graphEvent } from "../../store/constellation.ts";
import { foldLogbook, type LogbookEvent } from "../logbook/index.ts";
import { cutDiff } from "./diff.ts";

/** A marked Task claimed and then judged, as the envelopes the store would hold. */
const story = (verdict: "approve" | "send_back", accept: boolean) => {
  const envelopes: Array<LogbookEvent> = [];
  let record: ConstellationRecord | undefined;

  const run = (command: ConstellationCommand, context: ConstellationContext) => {
    const decision = decideConstellation(record, command, context);

    if (decision.rejection !== null) throw new Error(JSON.stringify(decision.rejection.findings));

    for (const event of decision.events) {
      const graph = graphEvent(event);

      if (graph !== null)
        envelopes.push({
          sequence: Sequence.make(envelopes.length + 1),
          occurredAt: context.now,
          event: graph,
        });
    }

    record = foldDecision(record, decision.events);

    return record;
  };

  const marked = new TaskDefinition({
    id: A,
    title: A,
    brief: "Build A",
    kind: "task",
    inspect: { accept },
  });

  run(
    C.Plan.make({
      constellationId: CID,
      start: { name: "Build", workspaceId: WS, leadSessionId: LEAD },
      operations: [PlanOperation.cases.Add.make({ task: marked })],
    }),
    ctx()
  );
  run(C.Dispatch.make({ constellationId: CID, tasks: [] }), ctx({ attempts: [draft()] }));

  const claimed = run(
    C.WorkerClaim.make({ constellationId: CID, attemptId: draft().id, claim: report() }),
    ctx({
      binding: { kind: "session", sessionId: draft().sessionId },
      claimProbe: { dirtyPaths: [], branch: "polaris/A", head: "head" },
    })
  );

  const inspection = claimed.graph.attempts[0]!.inspection!;

  run(
    C.Inspect.make({
      constellationId: CID,
      attemptId: draft().id,
      inspectionId: inspection.id,
      verdict,
      reason: "Checked the retry path.",
    }),
    ctx({
      binding: { kind: "session", sessionId: inspection.sessionId },
      inspectorMerge: { refusal: null },
      attempts: [
        draft(A, "a2", draft().sessionId, AttemptCause.cases.SentBack.make({ ref: draft().id })),
      ],
    })
  );

  return foldLogbook(envelopes).entries.filter((e) => !Predicate.isTagged(e, "Brief"));
};

const told = (entries: ReturnType<typeof story>) =>
  entries.map((e) =>
    Predicate.isTagged(e, "Inspection")
      ? `${e.author} inspection ${e.verdict} -> ${e.route} next ${e.nextAttempt}: ${e.text}`
      : `${e.author} ${e._tag}${Predicate.isTagged(e, "Review") ? ` ${e.outcome}` : ""}`
  );

test("an approval is one inspection entry that went to the Lead", () => {
  expect(told(story("approve", false))).toEqual([
    "worker Claim",
    "inspector inspection approve -> lead next null: Checked the retry path.",
  ]);
});

test("a send-back is the inspection entry alone, naming the Attempt it started", () => {
  expect(told(story("send_back", false))).toEqual([
    "worker Claim",
    "inspector inspection send_back -> sent_back next 2: Checked the retry path.",
  ]);
});

test("an approval under the grant is followed by the Inspector's accept with its merged head", () => {
  const entries = story("approve", true);

  expect(told(entries)).toEqual([
    "worker Claim",
    "inspector inspection approve -> accepted next null: Checked the retry path.",
    "inspector Review accepted",
  ]);
  expect(entries.at(-1)).toMatchObject({ mergedHead: "head", attempt: 1 });
});

test("a diff past the limit is cut after its stat, and says how much is left out", () => {
  const cut = cutDiff(" a.ts | 2 +-", "x".repeat(50), 10);

  expect(cut).toBe(
    [
      " a.ts | 2 +-",
      "",
      "x".repeat(10),
      "… cut after 10 of 50 characters; read the rest with git diff.",
    ].join("\n")
  );
  expect(cutDiff("stat", "short", 10)).toBe("short");
});
