/**
 * Review Checkouts as the engine drives them (ENG-221, ENG-228): after
 * `OpenReviewCheckout`, `UpdateReviewCheckout` or `RemoveReviewCheckout`
 * commits, do the git part (`ReviewCheckoutGit`, hooks off), then signal the
 * checkout machine (`checkout.ts`) with what happened. One checkout's steps run
 * one at a time; a Daemon restart picks up a fetch or removal it interrupted.
 */
import { sep } from "node:path";
import {
  type ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  type ReviewCheckoutId,
  type ReviewCheckoutState,
  ReviewCheckoutStatus,
  ReviewSubject,
  type SessionId,
  type SessionState,
  type Turn,
  type Workspace,
} from "@polaris/protocol";
import { Context, Effect, Layer, Option, Predicate, Semaphore, Stream } from "effect";
import type { Fetched } from "../git/review/index.ts";
import { lockReasonFor } from "../git/review/index.ts";
import { CheckoutBlocked, ReviewCheckoutGit, type ServiceError } from "../services.ts";
import type { LiveItem } from "../store/hub.ts";
import type { ReadModel } from "../store/model.ts";
import { Terminals } from "../terminal/Terminals.ts";
import { type CheckoutInput, decideCheckout } from "./checkout.ts";
import { EngineRuntime } from "./runtime.ts";

type Subject<Tag extends ReviewSubject["_tag"]> = Extract<ReviewSubject, { _tag: Tag }>;

/** Sessions doing something in a checkout block moving or removing it. */
const RUNNING: ReadonlySet<SessionState> = new Set([
  "starting",
  "working",
  "needs-you",
  "in-terminal",
]);

const isInside = (dir: string, cwd: string): boolean => cwd === dir || cwd.startsWith(dir + sep);

/** The review refs' key: `<number>` for a pull request, `session-<id>` for Turns. */
export const reviewKeyOf = (subject: ReviewSubject): string =>
  ReviewSubject.match(subject, {
    PullRequest: ({ pullRequest }) => String(pullRequest.number),
    SessionTurns: ({ sessionId }) => `session-${sessionId}`,
  });

const lockLabelOf = (checkout: ReviewCheckout): string =>
  ReviewSubject.match(checkout.subject, {
    PullRequest: ({ pullRequest }) =>
      `${checkout.workspaceId} ${pullRequest.repo.owner}/${pullRequest.repo.name}#${pullRequest.number}`,
    SessionTurns: ({ sessionId }) => `${checkout.workspaceId} session ${sessionId}`,
  });

const fetchFailedBlocker = (message: string) =>
  ReviewCheckoutBlocker.cases.FetchFailed.make({ message });

const fetchFailed = (message: string) =>
  new CheckoutBlocked({ blocker: fetchFailedBlocker(message) });

/** Agent Sessions whose cwd is inside `path`: running ones, or every one not Archived. */
export const sessionsInside = (
  model: ReadModel,
  path: string,
  which: "running" | "open"
): ReadonlyArray<SessionId> =>
  [...model.sessions.values()].flatMap(({ session }) => {
    const counts = which === "running" ? RUNNING.has(session.state) : session.state !== "archived";

    return counts && isInside(path, session.cwd) ? [session.id] : [];
  });

/** The first and last Turn of a `SessionTurns` subject, in order. */
const turnRange = (turns: ReadonlyArray<Turn>, subject: Subject<"SessionTurns">) => {
  const sorted = [...turns].sort((a, b) => a.index - b.index);

  const byId = (id: Turn["id"] | null, fallback: Turn | undefined) =>
    id === null ? fallback : sorted.find((t) => t.id === id);

  return {
    first: byId(subject.firstTurnId, sorted[0]),
    last: byId(subject.lastTurnId, sorted.at(-1)),
  };
};

/** A Turn's after-checkpoint: what makes a review of "through the latest Turn" stale. */
const isAfterCheckpoint = (item: LiveItem): boolean => {
  if (!Predicate.isTagged(item, "Event")) return false;
  const event = item.envelope.event;

  return Predicate.isTagged(event, "CheckpointRecorded") && event.ref.endsWith("/after");
};

/** Review Checkouts of a session's Turns through its latest one. */
const followingLatestTurn = (model: ReadModel, sessionId: SessionId) =>
  [...model.reviewCheckouts.values()].filter(
    ({ subject }) =>
      Predicate.isTagged(subject, "SessionTurns") &&
      subject.sessionId === sessionId &&
      subject.lastTurnId === null
  );

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const git = yield* ReviewCheckoutGit;
  const terminals = yield* Effect.serviceOption(Terminals);
  const { store } = rt;
  const locks = new Map<ReviewCheckoutId, Semaphore.Semaphore>();

  const serially =
    (checkoutId: ReviewCheckoutId) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      let lock = locks.get(checkoutId);

      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(checkoutId, lock);
      }

      return lock.withPermits(1)(effect);
    };

  /** Run one input through the checkout machine against the latest model and commit it. */
  const signal = (checkoutId: ReviewCheckoutId, input: CheckoutInput) =>
    store.commit({
      commandId: null,
      decide: (model) =>
        Effect.sync(() => decideCheckout(model.reviewCheckouts.get(checkoutId), input).events),
    });

  const block = (
    checkout: ReviewCheckout,
    during: ReviewCheckoutBlock["during"],
    blocker: ReviewCheckoutBlocker
  ) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Review Checkout ${checkout.id} blocked during ${during}`, blocker);
      yield* signal(checkout.id, {
        type: "checkout.blocked",
        block: new ReviewCheckoutBlock({ during, blocker }),
        at: yield* rt.now,
      });
    });

  const terminalsInside = (path: string) =>
    Option.match(terminals, {
      onNone: () => Effect.succeed(0),
      onSome: (service) =>
        Effect.map(
          service.list,
          (list) => list.filter((t) => t.exit === null && isInside(path, t.cwd)).length
        ),
    });

  /** InUse when a running session or an open terminal is inside the checkout. */
  const inUse = (checkout: ReviewCheckout, model: ReadModel) =>
    Effect.gen(function* () {
      const sessionIds = sessionsInside(model, checkout.path, "running");
      const open = yield* terminalsInside(checkout.path);

      return sessionIds.length === 0 && open === 0
        ? null
        : ReviewCheckoutBlocker.cases.InUse.make({ sessionIds, terminals: open });
    });

  /** The checkpoint commits an Agent Session's Turns span, pinned under review refs. */
  const pinSessionTurns = (
    workspace: Workspace,
    key: string,
    subject: Subject<"SessionTurns">
  ): Effect.Effect<Fetched, CheckoutBlocked | ServiceError> =>
    Effect.gen(function* () {
      const record = (yield* store.model).sessions.get(subject.sessionId);

      if (record === undefined) return yield* fetchFailed("the Agent Session is gone");

      const stored = yield* store.readTurns({
        sessionId: subject.sessionId,
        beforeIndex: null,
        limit: null,
      });

      const turns = new Map([...stored, ...record.turns].map((turn) => [turn.id, turn]));
      const { first, last } = turnRange([...turns.values()], subject);
      const base = first?.checkpointBefore ?? null;
      const head = last?.checkpointAfter ?? null;

      if (base === null || head === null) {
        return yield* fetchFailed("these Turns have no checkpoints to review");
      }

      return yield* git.pinCommits({ repoPath: workspace.path, key, head, base });
    });

  const fetchSubject = (checkout: ReviewCheckout, workspace: Workspace, unshallow: boolean) => {
    const key = reviewKeyOf(checkout.subject);

    return ReviewSubject.match(checkout.subject, {
      PullRequest: ({ pullRequest, baseRef }) =>
        git.fetchPullRequest({
          repoPath: workspace.path,
          key,
          repo: pullRequest.repo,
          number: pullRequest.number,
          baseRef,
          baseCommit: checkout.latestBase,
          unshallow,
        }),
      SessionTurns: (subject) => pinSessionTurns(workspace, key, subject),
    });
  };

  /** Put the worktree on `head`: create it, or move it when the update may go ahead. */
  const placeWorktree = (
    checkout: ReviewCheckout,
    workspace: Workspace,
    head: string,
    discardChanges: boolean
  ): Effect.Effect<ReviewCheckoutBlocker | null, ServiceError> =>
    Effect.gen(function* () {
      const inspection = yield* git.inspect(checkout.path, checkout.head);

      if (!inspection.present) {
        yield* git.ensure({
          repoPath: workspace.path,
          path: checkout.path,
          head,
          lockReason: lockReasonFor(lockLabelOf(checkout)),
        });

        return null;
      }

      if (!discardChanges && inspection.dirtyPaths.length > 0) {
        return ReviewCheckoutBlocker.cases.Dirty.make({ paths: inspection.dirtyPaths });
      }

      if (!discardChanges && inspection.localCommits > 0) {
        return ReviewCheckoutBlocker.cases.LocalCommits.make({ count: inspection.localCommits });
      }

      yield* git.move({ path: checkout.path, head, discardChanges });

      return null;
    });

  /** Fetch and check out a checkout that is `fetching` (on open, update, or after a restart). */
  const fetchAndPlace = (
    checkoutId: ReviewCheckoutId,
    options: { readonly discardChanges: boolean; readonly unshallow: boolean }
  ) =>
    serially(checkoutId)(
      Effect.gen(function* () {
        const model = yield* store.model;
        const checkout = model.reviewCheckouts.get(checkoutId);

        if (checkout?.state !== "fetching") return;
        const workspace = model.workspaces.get(checkout.workspaceId);
        const during = checkout.head === null ? "fetch" : "update";

        if (workspace === undefined) {
          return yield* block(checkout, during, fetchFailedBlocker("the Workspace was removed"));
        }

        const busy = during === "update" ? yield* inUse(checkout, model) : null;

        if (busy !== null) return yield* block(checkout, during, busy);

        const fetched = yield* fetchSubject(checkout, workspace, options.unshallow).pipe(
          Effect.catchTag("CheckoutBlocked", (error) =>
            block(checkout, "fetch", error.blocker).pipe(Effect.as(null))
          )
        );

        if (fetched === null) return;

        const refused = yield* placeWorktree(
          checkout,
          workspace,
          fetched.head,
          options.discardChanges
        );

        if (refused !== null) return yield* block(checkout, during, refused);
        yield* signal(checkout.id, { type: "checkout.fetched", ...fetched, at: yield* rt.now });
      }).pipe(Effect.catchTag("ServiceError", (error) => failStep(checkoutId, error)))
    );

  /** A git step failed outright: the checkout is blocked with git's message. */
  const failStep = (checkoutId: ReviewCheckoutId, error: ServiceError) =>
    Effect.gen(function* () {
      const checkout = (yield* store.model).reviewCheckouts.get(checkoutId);

      if (checkout === undefined) return;
      let during: ReviewCheckoutBlock["during"] = checkout.head === null ? "fetch" : "update";

      if (checkout.state === "removing") during = "remove";
      yield* block(checkout, during, fetchFailedBlocker(error.message));
    });

  /** Remove a checkout that is `removing`, unless something blocks it. */
  const removeNow = (checkoutId: ReviewCheckoutId, repoPath: string | null) =>
    serially(checkoutId)(
      Effect.gen(function* () {
        const model = yield* store.model;
        const checkout = model.reviewCheckouts.get(checkoutId);

        if (checkout?.state !== "removing") return;
        const busy = yield* inUse(checkout, model);

        if (busy !== null) return yield* block(checkout, "remove", busy);
        const inspection = yield* git.inspect(checkout.path, checkout.head);

        if (inspection.dirtyPaths.length > 0) {
          return yield* block(
            checkout,
            "remove",
            ReviewCheckoutBlocker.cases.Dirty.make({ paths: inspection.dirtyPaths })
          );
        }

        if (inspection.localCommits > 0) {
          return yield* block(
            checkout,
            "remove",
            ReviewCheckoutBlocker.cases.LocalCommits.make({ count: inspection.localCommits })
          );
        }

        yield* git.remove({
          repoPath: model.workspaces.get(checkout.workspaceId)?.path ?? repoPath,
          path: checkout.path,
          key: reviewKeyOf(checkout.subject),
        });
        yield* signal(checkout.id, { type: "checkout.removed" });
      }).pipe(Effect.catchTag("ServiceError", (error) => failStep(checkoutId, error)))
    );

  const opened = (checkoutId: ReviewCheckoutId) =>
    fetchAndPlace(checkoutId, { discardChanges: false, unshallow: false });

  /** An update from a shallow-clone block is the user asking for full history. */
  const updated = (checkoutId: ReviewCheckoutId, discardChanges: boolean, before: ReadModel) => {
    const blocker = before.reviewCheckouts.get(checkoutId)?.blocked?.blocker;
    const unshallow = blocker !== undefined && Predicate.isTagged(blocker, "ShallowClone");

    return fetchAndPlace(checkoutId, { discardChanges, unshallow });
  };

  const removed = (checkoutId: ReviewCheckoutId) => removeNow(checkoutId, null);

  /** A removed Workspace's checkouts go too (guarded as ever); its path comes from `before`. */
  const workspaceRemoved = (workspace: Workspace) =>
    Effect.gen(function* () {
      const model = yield* store.model;

      const mine = [...model.reviewCheckouts.values()].filter(
        (checkout) => checkout.workspaceId === workspace.id
      );

      yield* Effect.forEach(
        mine,
        (checkout) =>
          Effect.gen(function* () {
            yield* signal(checkout.id, { type: "checkout.remove", at: yield* rt.now });
            yield* removeNow(checkout.id, workspace.path);
          }),
        { discard: true }
      );
    });

  /** After a restart: finish the fetches and removals the last run left in flight. */
  const recover = Effect.gen(function* () {
    const model = yield* store.model;

    const steps: Partial<
      Record<ReviewCheckoutState, (id: ReviewCheckoutId) => Effect.Effect<void, ServiceError>>
    > = { fetching: opened, removing: removed };

    for (const checkout of model.reviewCheckouts.values()) {
      const step = steps[checkout.state];

      if (step === undefined) continue;
      yield* Effect.forkIn(
        step(checkout.id).pipe(
          Effect.catchCause((cause) => Effect.logError(`recovering ${checkout.id} failed`, cause))
        ),
        rt.engineScope
      );
    }
  });

  /**
   * A new Turn's after-checkpoint is the new head of every checkout following
   * that session's latest Turn: it goes stale, and an update moves it there.
   */
  const onCheckpoint = (item: LiveItem) =>
    Effect.gen(function* () {
      if (!Predicate.isTagged(item, "Event")) return;
      const event = item.envelope.event;

      if (!Predicate.isTagged(event, "CheckpointRecorded")) return;
      const model = yield* store.model;

      for (const checkout of followingLatestTurn(model, event.sessionId)) {
        yield* signal(checkout.id, {
          type: "checkout.reportHead",
          head: event.commit,
          base: "",
          at: yield* rt.now,
        });
      }
    });

  /** Re-subscribes if the store drops this subscriber for falling behind. */
  const followSessions = Effect.forkIn(
    Effect.scoped(
      Effect.gen(function* () {
        const live = yield* store.subscribe({ filter: isAfterCheckpoint });
        yield* Stream.runForEach(live, (item) =>
          onCheckpoint(item).pipe(
            Effect.catchCause((cause) => Effect.logError("following a session's Turns", cause))
          )
        );
      })
    ).pipe(Effect.forever),
    rt.engineScope
  ).pipe(Effect.asVoid);

  /** What blocks the checkout on disk now (`review.checkoutStatus`). */
  const status = (checkoutId: ReviewCheckoutId) =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const checkout = model.reviewCheckouts.get(checkoutId);

      if (checkout === undefined) return null;
      const inspection = yield* git.inspect(checkout.path, checkout.head);

      return new ReviewCheckoutStatus({
        checkout,
        dirtyPaths: inspection.dirtyPaths,
        localCommits: inspection.localCommits,
        sessionsInside: sessionsInside(model, checkout.path, "open"),
        terminalsInside: yield* terminalsInside(checkout.path),
        diskBytes: null,
      });
    });

  /** The Risk Summary covered `head`: record it in git and in the checkout. */
  const reviewed = (checkoutId: ReviewCheckoutId, head: string, mergeBase: string) =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const checkout = model.reviewCheckouts.get(checkoutId);
      const workspace = checkout && model.workspaces.get(checkout.workspaceId);

      if (checkout === undefined || workspace === undefined) return;
      yield* git.markReviewed({
        repoPath: workspace.path,
        key: reviewKeyOf(checkout.subject),
        head,
        mergeBase,
      });
      yield* signal(checkoutId, { type: "checkout.reviewed", head, mergeBase, at: yield* rt.now });
    });

  return ReviewCheckouts.of({
    opened,
    updated,
    removed,
    workspaceRemoved,
    recover,
    followSessions,
    status,
    reviewed,
  });
});

export class ReviewCheckouts extends Context.Service<
  ReviewCheckouts,
  {
    /** `OpenReviewCheckout` committed: fetch and create the worktree. */
    readonly opened: (checkoutId: ReviewCheckoutId) => Effect.Effect<void, ServiceError>;
    /** `UpdateReviewCheckout` committed (`before`: the model it was decided against). */
    readonly updated: (
      checkoutId: ReviewCheckoutId,
      discardChanges: boolean,
      before: ReadModel
    ) => Effect.Effect<void, ServiceError>;
    /** `RemoveReviewCheckout` committed: remove it unless something blocks it. */
    readonly removed: (checkoutId: ReviewCheckoutId) => Effect.Effect<void, ServiceError>;
    readonly workspaceRemoved: (workspace: Workspace) => Effect.Effect<void, ServiceError>;
    /** Fork the steps a restart interrupted into the Engine's scope. */
    readonly recover: Effect.Effect<void>;
    /** Fork the follower that makes Agent Session checkouts stale on new Turns. */
    readonly followSessions: Effect.Effect<void>;
    /** Null when there is no such checkout. */
    readonly status: (
      checkoutId: ReviewCheckoutId
    ) => Effect.Effect<ReviewCheckoutStatus | null, ServiceError>;
    /** For the Reviewer: the Risk Summary covered `head` (`reviewed` refs and the checkout). */
    readonly reviewed: (
      checkoutId: ReviewCheckoutId,
      head: string,
      mergeBase: string
    ) => Effect.Effect<void, ServiceError>;
  }
>()("polaris/daemon/engine/ReviewCheckouts") {
  static readonly layer = Layer.effect(ReviewCheckouts, make);
}
