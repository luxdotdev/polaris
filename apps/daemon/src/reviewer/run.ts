/**
 * One Risk Summary: started (or the cached one answered), then the Rules and
 * the Reviewer in turn, the cost line, and its end. The Reviewer's layer runs
 * in its own read-only Agent Session and reports through `output.ts`.
 */
import {
  DomainEvent,
  LayerRun,
  type ResolvedReviewer,
  type ReviewContext,
  type ReviewCheckoutId,
  type ReviewerChoice,
  type ReviewerSettings,
  ReviewerRun,
  type ReviewSubject,
  RiskSummary,
  RiskSummaryId,
  RiskSummaryLayers,
  RiskSummaryRef,
  type SessionId,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, Result } from "effect";
import { checkoutGitRaw } from "../git/review/refs.ts";
import { recordRulesLayer } from "../rules/index.ts";
import { EventStore } from "../store/EventStore.ts";
import { currentPlanLimitNote, reviewerCost } from "./cost.ts";
import { type ChangeDiff, readDiff } from "./diff.ts";
import { isIgnored, readInstructions } from "./instructions.ts";
import {
  parseReviewerReply,
  type ReadLines,
  type ReviewerOutput,
  toRiskFindings,
} from "./output.ts";
import { repairPrompt, reviewPrompt } from "./prompt.ts";
import { canRunChecks } from "./policy.ts";
import { type ReviewRange, resolveRange } from "./range.ts";
import { askFirst, changedLines, switchedOff } from "./when.ts";
import { continueReviewerSession, startReviewerSession, type TurnOutcome } from "./session.ts";

export interface RunRequest {
  readonly workspaceId: WorkspaceId;
  readonly subject: ReviewSubject;
  readonly checkoutId: ReviewCheckoutId | null;
  readonly since: string | null;
  readonly refresh: boolean;
  readonly context: ReviewContext | null;
}

const commit = (events: ReadonlyArray<DomainEvent>) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    yield* store.commit({ commandId: null, decide: () => Effect.succeed(events) });
  }).pipe(Effect.orDie);

const agentLayer = (summaryId: RiskSummaryId, run: LayerRun) =>
  commit([DomainEvent.cases.RiskSummaryLayerChanged.make({ summaryId, layer: "agent", run })]);

const readSummary = (summaryId: RiskSummaryId) =>
  Effect.gen(function* () {
    const store = yield* EventStore;

    return yield* store.review.riskSummary(RiskSummaryRef.cases.ById.make({ summaryId }));
  });

const decoder = new TextDecoder();

/** A file's lines at head (`new`) or the diff's base (`old`), read from git's objects. */
export const linesAt =
  (cwd: string, base: string, head: string): ReadLines =>
  (path, side) =>
    Effect.promise(async () => {
      const result = await checkoutGitRaw(cwd, ["show", `${side === "new" ? head : base}:${path}`]);

      return result.code === 0 ? decoder.decode(result.stdout).split("\n") : null;
    });

// ── Starting ────────────────────────────────────────────────────────────────

/** The summary to answer: the cached one for the key (unless refreshed or failed), else null. */
const cached = (range: ReviewRange, refresh: boolean) =>
  Effect.gen(function* () {
    if (refresh) return null;
    const store = yield* EventStore;

    const summary = yield* store.review.riskSummary(
      RiskSummaryRef.cases.ByKey.make({ key: range.key })
    );

    return summary !== null && summary.status !== "failed" ? summary : null;
  });

/** Who reviews this summary, and whether "When it runs" lets them now. */
export interface ReviewerPlan {
  readonly resolved: ResolvedReviewer;
  /** Why the Reviewer doesn't run by itself here (a switch is off); null when it does. */
  readonly off: string | null;
  /** Ask first above this many changed lines; null never asks. */
  readonly askAboveLines: number | null;
}

const agentAtStart = ({ resolved, off }: ReviewerPlan) => {
  if (resolved.choice === null) return LayerRun.make({ status: "skipped", note: resolved.note });

  return off === null
    ? LayerRun.make({ status: "pending", note: null })
    : LayerRun.make({ status: "skipped", note: off });
};

const startedSummary = (
  request: RunRequest,
  range: ReviewRange,
  plan: ReviewerPlan,
  now: string
) => {
  const { resolved } = plan;

  return RiskSummary.make({
    id: RiskSummaryId.make(`rs_${crypto.randomUUID()}`),
    key: range.key,
    workspaceId: range.workspaceId,
    subject: request.subject,
    checkoutId: range.checkoutId,
    status: "running",
    layers: RiskSummaryLayers.make({
      rules: LayerRun.make({ status: "pending", note: null }),
      agent: agentAtStart(plan),
    }),
    reviewer:
      resolved.choice === null
        ? null
        : ReviewerRun.make({
            harness: resolved.choice.harness,
            model: resolved.choice.model,
            effort: resolved.choice.effort,
            sessionId: null,
          }),
    cost: null,
    note: [range.note, resolved.note].filter((n) => n !== null).join(" ") || null,
    findings: [],
    startedAt: now,
    endedAt: null,
  });
};

// ── The Reviewer's layer ────────────────────────────────────────────────────

interface AgentInput {
  readonly summary: RiskSummary;
  readonly range: ReviewRange;
  readonly choice: ReviewerChoice;
  readonly context: ReviewContext | null;
}

const withoutIgnored = (diff: ChangeDiff, ignore: ReadonlyArray<string>): ChangeDiff =>
  ignore.length === 0 ? diff : { files: diff.files.filter((f) => !isIgnored(ignore, f.path)) };

const whyOf = (range: ReviewRange, context: ReviewContext | null): string | null => {
  if (context !== null) return context.body.trim() === "" ? null : context.body;

  return range.prompts.length === 0
    ? null
    : range.prompts.map((prompt, i) => `Prompt ${i + 1}:\n${prompt}`).join("\n\n");
};

/** The previous summary's open Reviewer Findings and session, for "only the new changes". */
const previousRun = (range: ReviewRange) =>
  Effect.gen(function* () {
    if (range.previousKey === null) return { findings: [], sessionId: null };
    const store = yield* EventStore;

    const previous = yield* store.review.riskSummary(
      RiskSummaryRef.cases.ByKey.make({ key: range.previousKey })
    );

    return {
      findings: (previous?.findings ?? []).filter(
        (f) => f.source === "agent" && f.status === "open"
      ),
      sessionId: previous?.reviewer?.sessionId ?? null,
    };
  });

/** The reply decoded, after one repair Turn if it didn't decode. */
const decodeWithRepair = (sessionId: SessionId, outcome: TurnOutcome) =>
  Effect.gen(function* () {
    const first = parseReviewerReply(outcome.reply ?? "");

    if (Result.isSuccess(first)) return first;
    const repaired = yield* continueReviewerSession(sessionId, repairPrompt(first.failure));

    return parseReviewerReply(repaired.reply ?? "");
  });

interface AgentResult {
  readonly sessionId: SessionId;
  readonly output: ReviewerOutput | null;
  readonly note: string | null;
}

const askReviewer = Effect.fn("askReviewer")(function* (input: AgentInput) {
  const { range, choice, summary } = input;
  const diff = yield* Effect.promise(() => readDiff(range.cwd, range.base, range.head));

  const instructions = yield* Effect.promise(() =>
    readInstructions({ cwd: range.cwd, head: range.head, repo: range.key.repo })
  );

  const current = yield* readSummary(summary.id);
  const previous = yield* previousRun(range);

  const prompt = reviewPrompt({
    subject: input.context === null ? range.title : `${range.title}: ${input.context.title}`,
    why: whyOf(range, input.context),
    instructions: instructions.text,
    ruleFindings: (current?.findings ?? []).filter((f) => f.source === "rule"),
    diff: withoutIgnored(diff, instructions.ignore),
    base: range.base,
    head: range.head,
    since: range.key.since,
    earlierFindings: previous.findings,
    runChecks: canRunChecks(choice.harness),
  });

  const outcome =
    previous.sessionId === null
      ? yield* startReviewerSession({
          workspaceId: range.workspaceId,
          checkoutId: range.checkoutId,
          choice,
          title: `Reviewer · ${range.title}`,
          prompt,
        })
      : {
          sessionId: previous.sessionId,
          ...(yield* continueReviewerSession(previous.sessionId, prompt)),
        };

  if (outcome.reply === null) {
    return {
      sessionId: outcome.sessionId,
      output: null,
      note: `The Reviewer's Turn ${outcome.status === "interrupted" ? "was interrupted" : "failed"}.`,
    } satisfies AgentResult;
  }

  const decoded = yield* decodeWithRepair(outcome.sessionId, outcome);

  return {
    sessionId: outcome.sessionId,
    output: Result.isSuccess(decoded) ? decoded.success : null,
    note: Result.isSuccess(decoded)
      ? null
      : "The Reviewer's reply couldn't be read, even after asking again.",
  } satisfies AgentResult;
});

/** Runs the Reviewer and records its Findings; the session it ran in, if any. */
const runAgentLayer = (input: AgentInput) =>
  Effect.gen(function* () {
    const { summary, range } = input;
    yield* agentLayer(summary.id, LayerRun.make({ status: "running", note: null }));

    const result = yield* askReviewer(input).pipe(
      Effect.catchCause((cause) => Effect.as(Effect.logWarning("the Reviewer failed", cause), null))
    );

    if (result === null || result.output === null) {
      yield* agentLayer(
        summary.id,
        LayerRun.make({
          status: "failed",
          note: result?.note ?? "The Reviewer could not run.",
        })
      );

      return result?.sessionId ?? null;
    }

    const converted = yield* toRiskFindings(
      result.output.findings,
      yield* Effect.promise(() => readDiff(range.cwd, range.base, range.head)),
      linesAt(range.cwd, range.base, range.head)
    );

    const dropped =
      converted.dropped > 0
        ? `${converted.dropped} of the Reviewer's findings pointed outside the diff and were left out.`
        : null;

    yield* commit([
      ...(converted.findings.length > 0
        ? [
            DomainEvent.cases.RiskFindingsRecorded.make({
              summaryId: summary.id,
              findings: converted.findings,
            }),
          ]
        : []),
      DomainEvent.cases.RiskSummaryLayerChanged.make({
        summaryId: summary.id,
        layer: "agent",
        run: LayerRun.make({ status: "completed", note: dropped }),
      }),
    ]);

    return result.sessionId;
  });

// ── The whole run ───────────────────────────────────────────────────────────

const ended = (summary: RiskSummary, sessionId: SessionId | null, resolved: ResolvedReviewer) =>
  Effect.gen(function* () {
    const choice = resolved.choice;
    const after = yield* readSummary(summary.id);
    const rulesFailed = after?.layers.rules.status === "failed";
    const agentFailed = after?.layers.agent.status !== "completed";

    const cost =
      choice === null || sessionId === null
        ? null
        : yield* reviewerCost(choice.harness, sessionId, summary.startedAt).pipe(
            Effect.catchCause(() => Effect.succeed(null))
          );

    const limitNote = choice === null ? null : yield* currentPlanLimitNote(choice.harness);
    const note = [summary.note, limitNote].filter((n) => n !== null).join(" ") || null;

    yield* commit([
      DomainEvent.cases.RiskSummaryEnded.make({
        summaryId: summary.id,
        status: rulesFailed && agentFailed ? "failed" : "completed",
        reviewer:
          choice === null
            ? null
            : ReviewerRun.make({
                harness: choice.harness,
                model: choice.model,
                effort: choice.effort,
                sessionId,
              }),
        cost,
        note,
      }),
    ]);

    return !(rulesFailed && agentFailed);
  });

/** The layers of a started summary, then its end. Never fails: a broken layer is recorded. */
/** The "Ask first" note when the change is over the threshold, else null. */
const overThreshold = (range: ReviewRange, askAboveLines: number | null) =>
  askAboveLines === null
    ? Effect.succeed(null)
    : Effect.promise(() => readDiff(range.cwd, range.base, range.head)).pipe(
        Effect.map((diff) => askFirst(changedLines(diff), askAboveLines))
      );

export const runLayers = (
  summary: RiskSummary,
  range: ReviewRange,
  input: {
    readonly plan: ReviewerPlan;
    readonly context: ReviewContext | null;
  }
) =>
  Effect.gen(function* () {
    yield* recordRulesLayer(summary.id, {
      cwd: range.cwd,
      base: range.base,
      head: range.head,
      mode: range.mode,
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("the Rules failed", cause)));

    const { plan } = input;
    const choice = plan.off === null ? plan.resolved.choice : null;
    const waiting = choice === null ? null : yield* overThreshold(range, plan.askAboveLines);

    if (waiting !== null)
      yield* agentLayer(summary.id, LayerRun.make({ status: "pending", note: waiting }));

    const sessionId =
      choice === null || waiting !== null
        ? null
        : yield* runAgentLayer({ summary, range, choice, context: input.context });

    return yield* ended(summary, sessionId, plan.resolved);
  });

export const startRun = (
  request: RunRequest,
  resolve: (
    workspaceId: WorkspaceId
  ) => Effect.Effect<{ readonly resolved: ResolvedReviewer; readonly settings: ReviewerSettings }>
) =>
  Effect.gen(function* () {
    const range = yield* resolveRange(request.subject, request.checkoutId, request.since);
    const existing = yield* cached(range, request.refresh);

    if (existing !== null) return { summary: existing, range, plan: null };
    const { resolved, settings } = yield* resolve(range.workspaceId);

    const plan: ReviewerPlan = {
      resolved,
      off: switchedOff(request.subject, settings, request.refresh),
      askAboveLines: request.refresh ? null : settings.askAboveLines,
    };

    const summary = startedSummary(request, range, plan, new Date().toISOString());
    yield* commit([DomainEvent.cases.RiskSummaryStarted.make({ summary })]);

    return { summary, range, plan };
  });
