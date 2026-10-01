/**
 * Follow-ups (ENG-222): "Ask about this" on a Finding, or a question about the
 * whole change, continues the Reviewer's own session. Its answer streams there;
 * Findings it adds, revises or withdraws are recorded on the summary.
 */
import {
  DomainEvent,
  HarnessUnavailable,
  NotFound,
  type RiskFinding,
  RiskFindingId,
  type RiskSummary,
  RiskSummaryRef,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import { Deferred, Duration, Effect, Option, Result } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { readDiff } from "./diff.ts";
import {
  parseReviewerReply,
  type ReviewerOutput,
  toRiskFinding,
  toRiskFindings,
} from "./output.ts";
import { followUpPrompt } from "./prompt.ts";
import { resolveRange, reviewedSessionOf } from "./range.ts";
import { linesAt } from "./run.ts";
import { continueReviewerSession } from "./session.ts";

/** Where the summary's change can still be read: its checkout, else the reviewed session's directory. */
const cwdOf = (summary: RiskSummary) =>
  Effect.gen(function* () {
    const model = yield* (yield* EventStore).model;

    const checkout =
      summary.checkoutId === null ? undefined : model.reviewCheckouts.get(summary.checkoutId);

    if (checkout !== undefined) return checkout.path;
    const sessionId = reviewedSessionOf(summary.subject);

    return sessionId === null ? null : (model.sessions.get(sessionId)?.session.cwd ?? null);
  });

const ownFinding = (summary: RiskSummary, id: string): RiskFinding | undefined =>
  summary.findings.find((f) => f.id === id && f.source === "agent");

/** The events a follow-up's output records: new and revised Findings, then withdrawals. */
export const followUpEvents = Effect.fn("followUpEvents")(function* (
  summary: RiskSummary,
  output: ReviewerOutput,
  change: ReviewedChange
) {
  const { cwd, base, head } = change;
  const diff = yield* Effect.promise(() => readDiff(cwd, base, head));
  const readLines = linesAt(cwd, base, head);
  const added = yield* toRiskFindings(output.findings, diff, readLines);
  const revised: Array<RiskFinding> = [];

  for (const { findingId, finding } of output.revised) {
    const own = ownFinding(summary, findingId);
    const next = own && (yield* toRiskFinding(finding, diff, readLines, own.id));

    if (next) revised.push(next);
  }

  const findings = [...added.findings, ...revised];

  const withdrawn = output.withdrawn.flatMap(({ findingId, note }) => {
    const own = ownFinding(summary, findingId);

    return own === undefined || own.status === "resolved"
      ? []
      : [
          DomainEvent.cases.RiskFindingResolved.make({
            summaryId: summary.id,
            findingId: RiskFindingId.make(own.id),
            resolution: "withdrawn",
            note,
          }),
        ];
  });

  return [
    ...(findings.length > 0
      ? [DomainEvent.cases.RiskFindingsRecorded.make({ summaryId: summary.id, findings })]
      : []),
    ...withdrawn,
  ];
});

/** Where and between what the summary's change is read. */
interface ReviewedChange {
  readonly cwd: string;
  readonly base: string;
  readonly head: string;
}

/**
 * The change the summary reviewed: its range again (an Agent Session's is
 * composed from its Turns), else its key's commits where they can be read.
 */
const changeOf = (summary: RiskSummary) =>
  Effect.gen(function* () {
    const range = yield* resolveRange(summary.subject, summary.checkoutId, summary.key.since).pipe(
      Effect.option
    );

    if (Option.isSome(range) && range.value.key.head === summary.key.head) {
      return { cwd: range.value.cwd, base: range.value.base, head: range.value.head };
    }

    const cwd = yield* cwdOf(summary);

    return cwd === null ? null : { cwd, base: summary.key.mergeBase, head: summary.key.head };
  });

/** After the follow-up's Turn: decode its reply and record what it changed. */
const applyReply = (summary: RiskSummary, reply: string | null) =>
  Effect.gen(function* () {
    const decoded = parseReviewerReply(reply ?? "");
    const change = yield* changeOf(summary);

    if (Result.isFailure(decoded) || change === null) return;
    const store = yield* EventStore;

    const latest =
      (yield* store.review.riskSummary(
        RiskSummaryRef.cases.ById.make({ summaryId: summary.id })
      )) ?? summary;

    const events = yield* followUpEvents(latest, decoded.success, change);

    if (events.length > 0) {
      yield* store.commit({ commandId: null, decide: () => Effect.succeed(events) });
    }
  });

export interface AskInput {
  readonly summary: RiskSummary;
  readonly findingId: RiskFindingId | null;
  readonly question: string;
  /** Answers the session's approvals by the read-only policy. */
  readonly register: (sessionId: SessionId) => Effect.Effect<void>;
  /** Runs the follow-up past the request (the Reviewer module's scope). */
  readonly fork: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

export const askReviewer = Effect.fn("askReviewer")(function* (input: AskInput) {
  const { summary } = input;

  const finding =
    input.findingId === null ? null : summary.findings.find((f) => f.id === input.findingId);

  if (finding === undefined) {
    return yield* new NotFound({ what: "risk finding", id: input.findingId ?? "" });
  }

  const sessionId = summary.reviewer?.sessionId ?? null;

  if (sessionId === null) {
    return yield* new HarnessUnavailable({
      harness: summary.reviewer?.harness ?? "claude",
      message: "No Reviewer ran for this Risk Summary, so there is no one to ask.",
    });
  }

  yield* input.register(sessionId);
  const sent = yield* Deferred.make<TurnId, string>();
  const prompt = followUpPrompt({ question: input.question, finding });

  yield* input.fork(
    continueReviewerSession(sessionId, prompt, (turnId) =>
      Effect.asVoid(Deferred.succeed(sent, turnId))
    ).pipe(
      Effect.flatMap((outcome) => applyReply(summary, outcome.reply)),
      Effect.catchCause((cause) =>
        Effect.andThen(
          Deferred.fail(sent, "The Reviewer's session didn't take the question."),
          Effect.logWarning("a Reviewer follow-up failed", cause)
        )
      )
    )
  );

  const turnId = yield* Deferred.await(sent).pipe(
    Effect.timeoutOption(Duration.seconds(30)),
    Effect.catch((message) =>
      Effect.succeed(Option.none<TurnId>()).pipe(Effect.tap(() => Effect.logWarning(message)))
    )
  );

  if (Option.isNone(turnId)) {
    return yield* new HarnessUnavailable({
      harness: summary.reviewer?.harness ?? "claude",
      message: "The Reviewer's session didn't take the question; try again once it is idle.",
    });
  }

  return { sessionId, turnId: turnId.value };
});
