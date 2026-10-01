/**
 * A test model over the Review Checkout machine for `xstate/graph`: abstract
 * Steps (a Client command, the code host moving on, the fetch breaking, the
 * user editing the checkout), each followed by what the reactor then does
 * with git, as the machine and `reviewCheckouts.ts` specify it. The world the
 * fake `ReviewCheckoutGit` answers from is part of the model. Not used in production.
 */
import {
  PullRequestRef,
  RepoRef,
  ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCheckoutId,
  ReviewSubject,
  WorkspaceId,
} from "@polaris/protocol";
import type { ActorLogic } from "xstate";
import {
  adjacencyMapToArray,
  getAdjacencyMap,
  getShortestPaths,
  type TraversalOptions,
} from "xstate/graph";
import { type CheckoutInput, decideCheckout } from "./checkout.ts";

export const AT = "2026-01-01T00:00:00.000Z";

export const CHECKOUT = ReviewCheckoutId.make("rc-model");

export const SUBJECT = ReviewSubject.cases.PullRequest.make({
  pullRequest: new PullRequestRef({
    repo: new RepoRef({ host: "github.com", owner: "acme", name: "app" }),
    number: 7,
  }),
  baseRef: "main",
});

export const MERGE_BASE = "m0";

export const FETCH_ERROR = "git fetch failed: the model broke it";

/** What a test can do. */
export type Step =
  | { readonly type: "open" }
  /** The code host gets a new head and the Client reports it. */
  | { readonly type: "push" }
  | { readonly type: "update" }
  | { readonly type: "updateDiscarding" }
  | { readonly type: "remove" }
  | { readonly type: "breakFetch" }
  | { readonly type: "fixFetch" }
  /** The user edits a file in the checkout. */
  | { readonly type: "edit" };

export const ALL_STEPS: ReadonlyArray<Step> = [
  { type: "open" },
  { type: "push" },
  { type: "update" },
  { type: "updateDiscarding" },
  { type: "remove" },
  { type: "breakFetch" },
  { type: "fixFetch" },
  { type: "edit" },
];

/** What the fake git answers from. */
export interface World {
  /** `h<n>`: the head on the code host; a few are enough. */
  readonly hostHead: number;
  readonly fetchBroken: boolean;
  readonly worktree: boolean;
  readonly dirty: boolean;
}

export const initialWorld: World = {
  hostHead: 1,
  fetchBroken: false,
  worktree: false,
  dirty: false,
};

export const MAX_HEAD = 3;

export const headName = (n: number) => `h${n}`;

/** What a test compares between the model and the Engine. */
export type Observed =
  | "absent"
  | {
      readonly state: ReviewCheckout["state"];
      readonly head: string | null;
      readonly latestHead: string;
      readonly blocked: string | null;
    };

export const observe = (checkout: ReviewCheckout | undefined): Observed =>
  checkout === undefined
    ? "absent"
    : {
        state: checkout.state,
        head: checkout.head,
        latestHead: checkout.latestHead,
        blocked:
          checkout.blocked === null
            ? null
            : `${checkout.blocked.during}:${checkout.blocked.blocker._tag}`,
      };

export interface ModelSnapshot {
  readonly status: "active";
  readonly output: undefined;
  readonly error: undefined;
  readonly checkout: ReviewCheckout | undefined;
  readonly world: World;
}

const initialModel: ModelSnapshot = {
  status: "active",
  output: undefined,
  error: undefined,
  checkout: undefined,
  world: initialWorld,
};

/** Fold one machine input, as the store does. */
const fold = (checkout: ReviewCheckout | undefined, input: CheckoutInput) => {
  const decision = decideCheckout(checkout, input);
  let next = checkout;

  for (const event of decision.events) {
    next = "checkout" in event ? event.checkout : undefined;
  }

  return { next, rejection: decision.rejection };
};

const block = (
  checkout: ReviewCheckout,
  during: ReviewCheckoutBlock["during"],
  blocker: ReviewCheckoutBlocker
) =>
  fold(checkout, {
    type: "checkout.blocked",
    block: new ReviewCheckoutBlock({ during, blocker }),
    at: AT,
  }).next;

const dirtyBlocker = ReviewCheckoutBlocker.cases.Dirty.make({ paths: ["feature.txt"] });

interface Settled {
  readonly checkout: ReviewCheckout | undefined;
  readonly world: World;
}

/** The reactor after a fetch is asked for: fetch, then create or move the worktree. */
const settleFetch = (checkout: ReviewCheckout, world: World, discardChanges: boolean): Settled => {
  const during = checkout.head === null ? "fetch" : "update";

  if (world.fetchBroken) {
    const failed = ReviewCheckoutBlocker.cases.FetchFailed.make({ message: FETCH_ERROR });

    return { checkout: block(checkout, "fetch", failed), world };
  }

  if (world.worktree && world.dirty && !discardChanges) {
    return { checkout: block(checkout, during, dirtyBlocker), world };
  }

  const fetched = fold(checkout, {
    type: "checkout.fetched",
    head: headName(world.hostHead),
    mergeBase: MERGE_BASE,
    at: AT,
  }).next;

  return { checkout: fetched, world: { ...world, worktree: true, dirty: false } };
};

/** The reactor after a removal is asked for. */
const settleRemove = (checkout: ReviewCheckout, world: World) =>
  world.dirty
    ? { checkout: block(checkout, "remove", dirtyBlocker), world }
    : {
        checkout: fold(checkout, { type: "checkout.removed" }).next,
        world: { ...world, worktree: false, dirty: false },
      };

const settle = (checkout: ReviewCheckout | undefined, world: World, discardChanges: boolean) => {
  if (checkout?.state === "fetching") return settleFetch(checkout, world, discardChanges);

  if (checkout?.state === "removing") return settleRemove(checkout, world);

  return { checkout, world };
};

export const openedCheckout = (path: string, world: World) =>
  new ReviewCheckout({
    id: CHECKOUT,
    workspaceId: WorkspaceId.make("ws-model"),
    subject: SUBJECT,
    path,
    state: "fetching",
    blocked: null,
    head: null,
    mergeBase: null,
    latestHead: headName(world.hostHead),
    latestBase: "",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: AT,
    updatedAt: AT,
  });

/** The Client command a step sends, as a machine input; null for steps that only change the world. */
const commandInput = (step: Step, world: World): CheckoutInput | null => {
  switch (step.type) {
    case "open":
      return { type: "checkout.open", checkout: openedCheckout("/model", world) };
    case "push":
      return { type: "checkout.reportHead", head: headName(world.hostHead), base: "", at: AT };
    case "update":
      return { type: "checkout.update", discardChanges: false, at: AT };
    case "updateDiscarding":
      return { type: "checkout.update", discardChanges: true, at: AT };
    case "remove":
      return { type: "checkout.remove", at: AT };
    default:
      return null;
  }
};

/** The world after a step's own change, before the command (if any) is sent. */
const worldBefore = (step: Step, world: World): World => {
  switch (step.type) {
    case "push":
      return { ...world, hostHead: Math.min(world.hostHead + 1, MAX_HEAD) };
    case "breakFetch":
      return { ...world, fetchBroken: true };
    case "fixFetch":
      return { ...world, fetchBroken: false };
    case "edit":
      return { ...world, dirty: world.worktree };
    default:
      return world;
  }
};

export interface ModelStep {
  readonly next: ModelSnapshot;
  /** Why the Engine refuses the step's command; "not found" when there is no checkout. */
  readonly rejection: string | null;
}

export const stepModel = (snapshot: ModelSnapshot, step: Step): ModelStep => {
  const world = worldBefore(step, snapshot.world);
  const input = commandInput(step, world);

  if (input === null) return { next: { ...snapshot, world }, rejection: null };

  if (snapshot.checkout === undefined && input.type !== "checkout.open") {
    return { next: { ...snapshot, world }, rejection: "not found" };
  }

  const decided = fold(snapshot.checkout, input);

  if (decided.rejection !== null) {
    return { next: { ...snapshot, world }, rejection: decided.rejection };
  }

  const discard = input.type === "checkout.update" && input.discardChanges;
  const settled = settle(decided.next, world, discard);

  return {
    next: { ...snapshot, checkout: settled.checkout, world: settled.world },
    rejection: null,
  };
};

const serialize = (snapshot: ModelSnapshot) =>
  JSON.stringify([observe(snapshot.checkout), snapshot.world]);

export const modelLogic: ActorLogic<ModelSnapshot, Step> = {
  transition: (snapshot: ModelSnapshot, step: Step) => [stepModel(snapshot, step).next, []],
  initialTransition: () => [initialModel, []],
  getInitialSnapshot: () => initialModel,
  getPersistedSnapshot: (snapshot: ModelSnapshot) => snapshot,
};

const traversal: TraversalOptions<ModelSnapshot, Step, unknown> = {
  events: [...ALL_STEPS],
  serializeState: serialize,
};

/** One shortest path to every model state, and one path per state-changing transition. */
export const checkoutPaths = () => {
  const shortest = getShortestPaths(modelLogic, traversal);
  const stepsOf = (path: (typeof shortest)[number]) => path.steps.slice(1).map((s) => s.event);
  const toState = new Map(shortest.map((path) => [serialize(path.state), stepsOf(path)]));
  const transitions: Array<ReadonlyArray<Step>> = [];

  for (const { state, event, nextState } of adjacencyMapToArray(
    getAdjacencyMap(modelLogic, traversal)
  )) {
    const key = serialize(state);

    if (serialize(nextState) !== key) transitions.push([...(toState.get(key) ?? []), event]);
  }

  return { states: shortest.map(stepsOf), transitions };
};
