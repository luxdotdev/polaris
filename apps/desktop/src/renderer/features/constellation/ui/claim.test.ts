import { describe, expect, test } from "bun:test";
import { ReviewAction } from "@polaris/protocol";
import { installConstellationClient, type Outcome, type ReviewInput } from "../client.ts";
import { merged } from "../model/fold.ts";
import { buildRail, plainFacts, type TaskRow } from "../model/index.ts";
import { c1Record, handedUpAttempts } from "../preview/graph.ts";
import { reviewMode } from "./claim.tsx";
import { approveClaim, placeOf, reviewClaim } from "./claimActions.ts";
import { type MenuActions, menuEntries } from "./menu.tsx";

const APPROVED = "2026-10-01T12:00:00Z";

const handed = (approved: boolean) =>
  c1Record({
    attempts: handedUpAttempts().map((a) =>
      a.taskId === "B1" && approved ? merged(a, { approvedByUserAt: APPROVED }) : a
    ),
  });

const b1Row = (approved: boolean) => {
  const row = buildRail(handed(approved), plainFacts()).rows.find(
    (r): r is TaskRow => r.kind === "task" && r.task.id === "B1"
  );

  if (row?.attempt == null) throw new Error("B1 has a Claim in review");

  return row;
};

const noop: MenuActions = {
  onReview: () => undefined,
  onApprove: () => undefined,
  onFocus: () => undefined,
  onOpenInReview: () => undefined,
  onMessageLead: () => undefined,
};

const labels = (row: TaskRow) =>
  menuEntries(row, noop).map((e) =>
    e.kind === "item" || e.kind === "sub" ? e.label : e.kind === "label" ? `(${e.text})` : "—"
  );

describe("a handed-up Claim", () => {
  test("the card opens on Approve until the user approves", () => {
    const attempt = b1Row(false).attempt!;
    const card = { attempt, review: null, handed: true, paused: false };

    expect(reviewMode(card)).toBe("approve");
    expect(reviewMode({ ...card, review: "accept" })).toBe("accept");
    expect(reviewMode({ ...card, attempt: merged(attempt, { approvedByUserAt: APPROVED }) })).toBe(
      null
    );
  });

  test("a paused Constellation's Claim still opens on Send back; the Lead's own stays closed", () => {
    const attempt = b1Row(false).attempt!;

    expect(reviewMode({ attempt, review: null, handed: false, paused: true })).toBe("send-back");
    expect(reviewMode({ attempt, review: null, handed: false, paused: false })).toBeNull();
    expect(
      reviewMode({
        attempt: merged(attempt, { state: "accepted" }),
        review: "approve",
        handed: true,
        paused: false,
      })
    ).toBeNull();
  });

  test("its row menu leads with Approve, which reaches the Lead", () => {
    const row = b1Row(false);
    const approved: Array<string> = [];

    expect(labels(row).slice(0, 3)).toEqual(["Approve", "Accept…", "Send back…"]);

    const first = menuEntries(row, { ...noop, onApprove: (r) => approved.push(r.task.id) })[0];

    if (first?.kind === "item") first.run();
    expect(approved).toEqual(["B1"]);
  });

  test("once approved, the menu says so and keeps Accept and Send back", () => {
    expect(labels(b1Row(true)).slice(0, 3)).toEqual([
      "(You approved · the lead merges)",
      "Accept…",
      "Send back…",
    ]);
  });
});

describe("Approve from the tab", () => {
  const sent: Array<ReviewInput> = [];

  const answer = (outcome: Outcome) => {
    sent.length = 0;
    const refuse = () => Promise.resolve<Outcome>({ ok: false, message: "", fix: null });

    installConstellationClient({
      review: (_host, input) => {
        sent.push(input);

        return Promise.resolve(outcome);
      },
      dispatch: refuse,
      answer: refuse,
      message: refuse,
      setState: refuse,
    });
  };

  test("sends Approve on the Claim's Attempt and revision to the Lead's Host", async () => {
    answer({ ok: true, summary: "approved" });
    const record = handed(false);
    const attempt = b1Row(false).attempt!;

    expect(await approveClaim("local", record, attempt, placeOf(attempt, null))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      constellationId: record.constellation.id,
      attemptId: attempt.id,
      revision: attempt.revision,
    });
    expect(sent[0]?.action).toEqual(ReviewAction.cases.Approve.make({}));
  });

  test("an Accept refused for an unmerged head comes back worded, with Approve offered", async () => {
    answer({
      ok: false,
      message: "The claimed head has not been merged into the Lead's branch. Fetch the branch…",
      fix: null,
      findings: [
        {
          code: "E-GIT",
          message: "The claimed head has not been merged into the Lead's branch",
          fix: "Fetch the branch, check the working tree, and retry.",
        },
      ],
    });
    const attempt = b1Row(false).attempt!;

    const copy = await reviewClaim(
      "local",
      {
        constellationId: handed(false).constellation.id,
        attemptId: attempt.id,
        revision: attempt.revision,
        action: ReviewAction.cases.Accept.make({ mergedHead: attempt.claim!.head, receipts: [] }),
      },
      placeOf(attempt, "main")
    );

    expect(copy).toEqual({
      message: `Merge ${attempt.branch} at ${attempt.claim!.head.slice(0, 7)} into main first, or approve and let the lead merge.`,
      offerApprove: true,
    });
  });
});
