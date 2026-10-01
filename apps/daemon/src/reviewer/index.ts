/**
 * The Reviewer (CONTEXT.md: Reviewer, Risk Summary): the module's interface.
 * See README.md for how a Risk Summary runs, and Linear ENG-222/225/229 for why.
 */
import {
  type GitError,
  type HarnessUnavailable,
  HostHarnesses,
  type NotFound,
  type ResolvedReviewer,
  type ReviewCheckout,
  type ReviewContext,
  ReviewSubject,
  type ReviewerSettings,
  type RiskFindingId,
  type RiskSummary,
  type RiskSummaryId,
  RiskSummaryRef,
  type SessionId,
  type TurnId,
  type WorkspaceId,
  DomainEvent,
  NotFound as NotFoundError,
} from "@polaris/protocol";
import { Context, Effect, Layer, Option, Predicate, Semaphore, Stream } from "effect";
import { Engine } from "../engine/Engine.ts";
import { Availability } from "../harness/availability/index.ts";
import { ApprovalPolicy, ReviewCheckoutGit, Rules, type ServiceError } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { REVIEWER_MARKER } from "./prompt.ts";
import { WALKTHROUGH_MARKER } from "./walkthroughPrompt.ts";
import { askReviewer } from "./ask.ts";
import { ReviewerSessions } from "./sessions.ts";
import { canRunChecks, reviewerDecision } from "./policy.ts";
import { resolveRange } from "./range.ts";
import { type RunRequest, runLayers, startRun } from "./run.ts";
import {
  recoverWalkthroughs,
  requestWalkthroughs,
  runWalkthroughs,
  stopWalkthroughs,
  walkthroughChoice,
} from "./walkthrough.ts";
import { loadSettings, resolveReviewer, saveSettings, settingsPath } from "./settings.ts";

export type { RunRequest } from "./run.ts";

export { ReviewerSessions } from "./sessions.ts";

/** `ApprovalPolicy` for the Engine: the Reviewer's sessions get the read-only policy, others ask the user. */
export const ReviewerPolicyLive = Layer.effect(
  ApprovalPolicy,
  Effect.gen(function* () {
    const sessions = yield* ReviewerSessions;

    return ApprovalPolicy.of({
      decide: (request) =>
        Effect.sync(() =>
          sessions.has(request.sessionId)
            ? reviewerDecision(request, { runChecks: canRunChecks(request.harness) })
            : null
        ),
      readOnly: (sessionId) => sessions.has(sessionId),
    });
  })
);

export class Reviewer extends Context.Service<
  Reviewer,
  {
    /** Start a Risk Summary (Rules, then the Reviewer), or answer the cached one. */
    readonly run: (request: RunRequest) => Effect.Effect<RiskSummary, NotFound | GitError>;
    readonly runWalkthrough: (
      summaryId: RiskSummaryId,
      context: ReviewContext | null
    ) => Effect.Effect<RiskSummary, NotFound | GitError>;
    readonly stopWalkthrough: (summaryId: RiskSummaryId) => Effect.Effect<void, NotFound>;
    readonly ask: (
      summaryId: RiskSummaryId,
      findingId: RiskFindingId | null,
      question: string
    ) => Effect.Effect<
      { readonly sessionId: SessionId; readonly turnId: TurnId },
      NotFound | HarnessUnavailable
    >;
    readonly settings: (workspaceId: WorkspaceId | null) => Effect.Effect<{
      readonly settings: ReviewerSettings;
      readonly resolved: ResolvedReviewer;
    }>;
    readonly setSettings: (settings: ReviewerSettings) => Effect.Effect<void, ServiceError>;
  }
>()("polaris/daemon/reviewer/Reviewer") {}

export interface ReviewerOptions {
  /** Where the settings persist; defaults to `~/.polaris/reviewer-settings.json`. */
  readonly settingsPath?: string;
  /** Run Risk Summaries on their own (accepted Turns, new commits on a reviewed checkout). Default true. */
  readonly automatic?: boolean;
}

const NO_HARNESSES = HostHarnesses.make({ harnesses: [], checkedAt: new Date(0).toISOString() });

/** What starts a Risk Summary without a Client asking, for one committed event. */
export const automaticRun = (
  event: DomainEvent,
  checkoutOf: (id: ReviewCheckout["id"]) => ReviewCheckout | undefined,
  workspaceOfSession: (id: SessionId) => WorkspaceId | null
): RunRequest | null =>
  DomainEvent.matchOrElse(
    event,
    {
      TurnEnded: ({ turn }): RunRequest | null => {
        const workspaceId = workspaceOfSession(turn.sessionId);

        return workspaceId === null || turn.status === "working"
          ? null
          : {
              workspaceId,
              subject: ReviewSubject.cases.SessionTurns.make({
                sessionId: turn.sessionId,
                firstTurnId: turn.id,
                lastTurnId: turn.id,
              }),
              checkoutId: null,
              since: null,
              refresh: false,
              context: null,
              rulesOnly: true,
            };
      },
      TurnsAccepted: ({ sessionId, throughTurnId }): RunRequest | null => {
        const workspaceId = workspaceOfSession(sessionId);

        return workspaceId === null
          ? null
          : {
              workspaceId,
              subject: ReviewSubject.cases.SessionTurns.make({
                sessionId,
                firstTurnId: null,
                lastTurnId: throughTurnId,
              }),
              checkoutId: null,
              since: null,
              refresh: false,
              context: null,
            };
      },
      ReviewCheckoutChanged: ({ checkout }): RunRequest | null => {
        const known = checkoutOf(checkout.id) ?? checkout;

        const moved =
          known.state === "ready" &&
          known.reviewedHead !== null &&
          known.head !== null &&
          known.head !== known.reviewedHead;

        return moved && Predicate.isTagged(known.subject, "PullRequest")
          ? {
              workspaceId: known.workspaceId,
              subject: known.subject,
              checkoutId: known.id,
              since: known.reviewedHead,
              refresh: false,
              context: null,
            }
          : null;
      },
    },
    () => null
  );

const make = (options: ReviewerOptions) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const engine = yield* Engine;
    const sessions = yield* ReviewerSessions;
    const availability = yield* Effect.serviceOption(Availability);

    const context = yield* Effect.context<
      EventStore | Engine | ReviewerSessions | ReviewCheckoutGit | Rules
    >();

    const scope = yield* Effect.scope;
    const path = options.settingsPath ?? settingsPath();
    const starting = yield* Semaphore.make(1);
    const activeWalkthroughs = new Set<string>();
    const model = yield* store.model;

    for (const record of model.sessions.values()) {
      if (
        record.turns.some(
          (turn) =>
            turn.prompt.startsWith(REVIEWER_MARKER) || turn.prompt.startsWith(WALKTHROUGH_MARKER)
        )
      )
        yield* sessions.register(record.session.id);
    }

    yield* recoverWalkthroughs();

    const resolve = (workspaceId: WorkspaceId | null) =>
      Effect.gen(function* () {
        const harnesses = Option.isSome(availability)
          ? yield* availability.value.get(false)
          : NO_HARNESSES;

        const settings = yield* loadSettings(path);

        return { settings, resolved: resolveReviewer(settings, workspaceId, harnesses) };
      });

    const fork = <R>(work: Effect.Effect<void, never, R>) =>
      Effect.asVoid(Effect.forkIn(work, scope));

    const start = (request: RunRequest) =>
      Effect.gen(function* () {
        const started = yield* starting.withPermits(1)(startRun(request, resolve));

        if (started.summary === null || started.plan === null) return started.summary;
        const { summary, range, plan } = started;

        const work = Effect.gen(function* () {
          const ok = yield* runLayers(summary, range, { plan, context: request.context });

          if (
            ok &&
            range.checkoutId !== null &&
            Predicate.isTagged(request.subject, "PullRequest")
          ) {
            yield* engine.checkoutReviewed(range.checkoutId, range.head, range.mergeBase);
          }
        }).pipe(
          Effect.catchCause((cause) => Effect.logError("a Risk Summary failed", cause)),
          Effect.provide(context)
        );

        yield* fork(
          runWalkthroughs(
            summary,
            range,
            request.context?.body ?? range.prompts.join("\n\n"),
            activeWalkthroughs
          ).pipe(
            Effect.catchCause((cause) => Effect.logError("a walkthrough failed", cause)),
            Effect.provide(context)
          )
        );
        yield* fork(work);

        return summary;
      }).pipe(Effect.provide(context));

    const run = (request: RunRequest) =>
      Effect.flatMap(start(request), (summary) =>
        summary === null
          ? Effect.die(new Error("a Risk Summary the Client asked for always starts"))
          : Effect.succeed(summary)
      );

    const ask = (summaryId: RiskSummaryId, findingId: RiskFindingId | null, question: string) =>
      Effect.gen(function* () {
        const summary = yield* store.review.riskSummary(
          RiskSummaryRef.cases.ById.make({ summaryId })
        );

        if (summary === null) {
          return yield* new NotFoundError({ what: "risk summary", id: summaryId });
        }

        return yield* askReviewer({
          summary,
          findingId,
          question,
          register: sessions.register,
          fork,
        });
      }).pipe(Effect.provide(context));

    const read = (summaryId: RiskSummaryId) =>
      Effect.gen(function* () {
        const summary = yield* store.review.riskSummary(
          RiskSummaryRef.cases.ById.make({ summaryId })
        );

        if (summary === null)
          return yield* new NotFoundError({ what: "risk summary", id: summaryId });

        return summary;
      });

    const runWalkthrough = (summaryId: RiskSummaryId, reviewContext: ReviewContext | null) =>
      starting.withPermits(1)(
        Effect.gen(function* () {
          const summary = yield* read(summaryId);
          const { settings, resolved } = yield* resolve(summary.workspaceId);
          const range = yield* resolveRange(summary.subject, summary.checkoutId, summary.key.since);

          const next = yield* requestWalkthroughs(
            summary,
            walkthroughChoice(settings, resolved.choice),
            activeWalkthroughs
          );

          yield* fork(
            runWalkthroughs(
              next,
              range,
              reviewContext?.body ?? range.prompts.join("\n\n"),
              activeWalkthroughs
            ).pipe(
              Effect.catchCause((cause) => Effect.logError("a walkthrough failed", cause)),
              Effect.provide(context)
            )
          );

          return next;
        }).pipe(Effect.provide(context))
      );

    const stopWalkthrough = (summaryId: RiskSummaryId) =>
      Effect.flatMap(read(summaryId), stopWalkthroughs).pipe(Effect.provide(context));

    if (options.automatic ?? true) {
      const live = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") &&
          (DomainEvent.guards.TurnsAccepted(item.envelope.event) ||
            DomainEvent.guards.TurnEnded(item.envelope.event) ||
            DomainEvent.guards.ReviewCheckoutChanged(item.envelope.event)),
      });

      yield* fork(
        Stream.runForEach(live, (item) =>
          Effect.gen(function* () {
            if (!Predicate.isTagged(item, "Event")) return;
            const model = yield* store.model;

            const request = automaticRun(
              item.envelope.event,
              (id) => model.reviewCheckouts.get(id),
              (id) =>
                sessions.has(id) ? null : (model.sessions.get(id)?.session.workspaceId ?? null)
            );

            if (request !== null) yield* Effect.ignore(start(request));
          })
        )
      );
    }

    return Reviewer.of({
      runWalkthrough,
      stopWalkthrough,
      run,
      ask,
      settings: (workspaceId) =>
        Effect.gen(function* () {
          return yield* resolve(workspaceId);
        }),
      setSettings: (settings) => saveSettings(path, settings),
    });
  });

/**
 * The Reviewer on the Engine. Needs `ReviewerSessions` (the same instance
 * the Engine's `ReviewerPolicyLive` reads), the store and the Rules.
 */
export const ReviewerLive = (options: ReviewerOptions = {}) =>
  Layer.effect(Reviewer, make(options));
