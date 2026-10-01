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
import { askReviewer } from "./ask.ts";
import { ReviewerSessions } from "./sessions.ts";
import { canRunChecks, reviewerDecision } from "./policy.ts";
import { type RunRequest, runLayers, startRun } from "./run.ts";
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

    const run = (request: RunRequest) =>
      Effect.gen(function* () {
        const started = yield* starting.withPermits(1)(startRun(request, resolve));

        if (started.plan === null) return started.summary;
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

        yield* fork(work);

        return summary;
      }).pipe(Effect.provide(context));

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

    if (options.automatic ?? true) {
      const live = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") &&
          (DomainEvent.guards.TurnsAccepted(item.envelope.event) ||
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
              (id) => model.sessions.get(id)?.session.workspaceId ?? null
            );

            if (request !== null) yield* Effect.ignore(run(request));
          })
        )
      );
    }

    return Reviewer.of({
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
