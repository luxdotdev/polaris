/**
 * The Reviewer (CONTEXT.md: Reviewer, Risk Summary): the module's interface.
 * See README.md for how a Risk Summary runs, and Linear ENG-222/225/229 for why.
 */
import {
  HostHarnesses,
  type ReviewContext,
  type RiskFindingId,
  type RiskSummaryId,
  RiskSummaryRef,
  type WorkspaceId,
  NotFound as NotFoundError,
} from "@polaris/protocol";
import { Effect, Layer, Option, Predicate, Semaphore } from "effect";
import { Engine } from "../engine/Engine.ts";
import { Availability } from "../harness/availability/index.ts";
import type { ReviewCheckoutGit, Rules } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { askReviewer } from "./ask.ts";
import { followAutomatic } from "./automatic.ts";
import { ReviewerSessions } from "./sessions.ts";
import { recoverReviewer } from "./recovery.ts";
import { resolveRange } from "./range.ts";
import { type RunRequest, runLayers, startRun } from "./run.ts";
import { Reviewer } from "./service.ts";
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

export { automaticRun } from "./automatic.ts";

export { Reviewer } from "./service.ts";

export { ReviewerPolicyLive } from "./policy.ts";

export interface ReviewerOptions {
  /** Where the settings persist; defaults to `~/.polaris/reviewer-settings.json`. */
  readonly settingsPath?: string;
  /** Run Risk Summaries on their own (accepted Turns, new commits on a reviewed checkout). Default true. */
  readonly automatic?: boolean;
}

const NO_HARNESSES = HostHarnesses.make({ harnesses: [], checkedAt: new Date(0).toISOString() });

const make = (options: ReviewerOptions) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const engine = yield* Engine;
    const sessions = yield* ReviewerSessions;
    const availability = yield* Effect.serviceOption(Availability);

    yield* recoverReviewer;

    const context = yield* Effect.context<
      EventStore | Engine | ReviewerSessions | ReviewCheckoutGit | Rules
    >();

    const scope = yield* Effect.scope;
    const path = options.settingsPath ?? settingsPath();
    const starting = yield* Semaphore.make(1);
    const activeWalkthroughs = new Set<string>();

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

    const runAutomatic = (request: RunRequest) => Effect.ignore(start(request));

    if (options.automatic ?? true) yield* followAutomatic(runAutomatic);

    return Reviewer.of({
      runAutomatic,
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
