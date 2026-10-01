/**
 * The Review Checkout lifecycle as an XState statechart, used as a pure
 * decider like the session machine (README.md here): its snapshot is derived
 * from the folded `ReviewCheckout`, one `transition` runs per input, and the
 * domain events it emits are what the store commits.
 *
 * Inputs are Client commands (`OpenReviewCheckout`, `ReportReviewHead`,
 * `UpdateReviewCheckout`, `RemoveReviewCheckout`) and the Checkout module's
 * signals once git has done its part (`checkout.fetched`, `checkout.blocked`,
 * `checkout.removed`, `checkout.reviewed`).
 */
import {
  DomainEvent,
  ReviewCheckout,
  ReviewCheckoutBlock,
  type ReviewCheckoutState,
} from "@polaris/protocol";
import { Schema } from "effect";
import { createMachine, transition, types } from "xstate";

const standard = Schema.toStandardSchemaV1;

const At = { at: Schema.String };

export const checkoutEventSchemas = {
  // Client commands
  "checkout.open": standard(Schema.Struct({ checkout: ReviewCheckout })),
  "checkout.reportHead": standard(
    Schema.Struct({ head: Schema.String, base: Schema.String, ...At })
  ),
  "checkout.update": standard(Schema.Struct({ discardChanges: Schema.Boolean, ...At })),
  "checkout.remove": standard(Schema.Struct(At)),
  // Signals from the Checkout module (M2-C)
  "checkout.fetched": standard(
    Schema.Struct({ head: Schema.String, mergeBase: Schema.String, ...At })
  ),
  "checkout.blocked": standard(Schema.Struct({ block: ReviewCheckoutBlock, ...At })),
  "checkout.removed": standard(Schema.Struct({})),
  "checkout.reviewed": standard(
    Schema.Struct({ head: Schema.String, mergeBase: Schema.String, ...At })
  ),
};

type Schemas = typeof checkoutEventSchemas;

export type CheckoutInput = {
  [K in keyof Schemas]: { readonly type: K } & Schemas[K]["Type"];
}[keyof Schemas];

interface Context {
  readonly checkout: ReviewCheckout | null;
}

type Emitted =
  | { readonly type: "domain"; readonly event: DomainEvent }
  | { readonly type: "rejected"; readonly reason: string };

type Enqueue = { emit: (emitted: Emitted) => void };

const HANDLED = {};

const need = (context: Context): ReviewCheckout => {
  if (context.checkout === null) throw new Error("the checkout machine needs a checkout");

  return context.checkout;
};

const reject = (enq: Enqueue, reason: string) => {
  enq.emit({ type: "rejected", reason });
};

const patch = (checkout: ReviewCheckout, change: Partial<typeof ReviewCheckout.Type>) =>
  new ReviewCheckout({
    id: checkout.id,
    workspaceId: checkout.workspaceId,
    subject: checkout.subject,
    path: checkout.path,
    state: checkout.state,
    blocked: checkout.blocked,
    head: checkout.head,
    mergeBase: checkout.mergeBase,
    latestHead: checkout.latestHead,
    latestBase: checkout.latestBase,
    reviewedHead: checkout.reviewedHead,
    reviewedMergeBase: checkout.reviewedMergeBase,
    openedAt: checkout.openedAt,
    updatedAt: checkout.updatedAt,
    ...change,
  });

/** Record the checkout as `next` and move to its state (re-entering, so a change is a transition). */
const change = (enq: Enqueue, next: ReviewCheckout) => {
  enq.emit({
    type: "domain",
    event: DomainEvent.cases.ReviewCheckoutChanged.make({ checkout: next }),
  });

  return { target: `#${next.state}`, reenter: true, context: { checkout: next } };
};

/** Fetched: ready at `head`, or straight to stale when the code host already moved on. */
const fetched = (
  {
    context,
    event,
  }: { context: Context; event: Extract<CheckoutInput, { type: "checkout.fetched" }> },
  enq: Enqueue
) => {
  const checkout = need(context);
  const state: ReviewCheckoutState = event.head === checkout.latestHead ? "ready" : "stale";

  return change(
    enq,
    patch(checkout, {
      state,
      blocked: null,
      head: event.head,
      mergeBase: event.mergeBase,
      updatedAt: event.at,
    })
  );
};

const toFetching = (
  { context, event }: { context: Context; event: { readonly at: string } },
  enq: Enqueue
) => change(enq, patch(need(context), { state: "fetching", blocked: null, updatedAt: event.at }));

const toRemoving = (
  { context, event }: { context: Context; event: { readonly at: string } },
  enq: Enqueue
) => change(enq, patch(need(context), { state: "removing", blocked: null, updatedAt: event.at }));

const toBlocked = (
  {
    context,
    event,
  }: { context: Context; event: Extract<CheckoutInput, { type: "checkout.blocked" }> },
  enq: Enqueue
) =>
  change(
    enq,
    patch(need(context), { state: "blocked", blocked: event.block, updatedAt: event.at })
  );

export const checkoutMachine = createMachine({
  id: "checkout",
  schemas: {
    context: types<Context>(),
    events: checkoutEventSchemas,
    emitted: {
      domain: types<{ event: DomainEvent }>(),
      rejected: types<{ reason: string }>(),
    },
  },
  context: { checkout: null },
  initial: "absent",
  // Defaults for a checkout that exists; states override what they accept.
  on: {
    "checkout.open": ({ context }, enq) =>
      reject(enq, `Review Checkout ${need(context).id} is already open`),
    "checkout.reportHead": ({ context, event }, enq) => {
      const checkout = need(context);

      if (checkout.latestHead === event.head && checkout.latestBase === event.base) return HANDLED;

      return change(
        enq,
        patch(checkout, { latestHead: event.head, latestBase: event.base, updatedAt: event.at })
      );
    },
    "checkout.update": toFetching,
    "checkout.remove": toRemoving,
    "checkout.reviewed": ({ context, event }, enq) =>
      change(
        enq,
        patch(need(context), {
          reviewedHead: event.head,
          reviewedMergeBase: event.mergeBase,
          updatedAt: event.at,
        })
      ),
    // A signal for a state that isn't waiting on it (a late or repeated report) changes nothing.
    "checkout.fetched": () => HANDLED,
    "checkout.blocked": () => HANDLED,
    "checkout.removed": () => HANDLED,
  },
  states: {
    absent: {
      id: "absent",
      on: {
        "checkout.open": ({ event }, enq) => {
          enq.emit({
            type: "domain",
            event: DomainEvent.cases.ReviewCheckoutOpened.make({ checkout: event.checkout }),
          });

          return { target: "#fetching", context: { checkout: event.checkout } };
        },
        "checkout.reportHead": (_, enq) => reject(enq, "there is no such Review Checkout"),
        "checkout.update": (_, enq) => reject(enq, "there is no such Review Checkout"),
        "checkout.remove": (_, enq) => reject(enq, "there is no such Review Checkout"),
        "checkout.reviewed": () => HANDLED,
      },
    },
    fetching: {
      id: "fetching",
      on: {
        "checkout.update": (_, enq) => reject(enq, "the Review Checkout is already being fetched"),
        "checkout.fetched": fetched,
        "checkout.blocked": toBlocked,
      },
    },
    ready: {
      id: "ready",
      on: {
        "checkout.reportHead": ({ context, event }, enq) => {
          const checkout = need(context);

          if (checkout.latestHead === event.head && checkout.latestBase === event.base) {
            return HANDLED;
          }

          return change(
            enq,
            patch(checkout, {
              state: event.head === checkout.head ? "ready" : "stale",
              latestHead: event.head,
              latestBase: event.base,
              updatedAt: event.at,
            })
          );
        },
        // Already at the latest head: nothing to fetch.
        "checkout.update": ({ context }) =>
          need(context).head === need(context).latestHead ? HANDLED : undefined,
      },
    },
    stale: { id: "stale", on: {} },
    blocked: {
      id: "blocked",
      on: {
        // Removal blocked (dirty, in use): trying again is a new removal.
        "checkout.blocked": toBlocked,
      },
    },
    removing: {
      id: "removing",
      on: {
        "checkout.update": (_, enq) => reject(enq, "the Review Checkout is being removed"),
        "checkout.remove": () => HANDLED,
        "checkout.reportHead": () => HANDLED,
        "checkout.blocked": toBlocked,
        "checkout.removed": ({ context }, enq) => {
          const checkout = need(context);
          enq.emit({
            type: "domain",
            event: DomainEvent.cases.ReviewCheckoutRemoved.make({
              checkoutId: checkout.id,
              workspaceId: checkout.workspaceId,
            }),
          });

          return { target: "#absent", context: { checkout: null } };
        },
      },
    },
  },
});

type CheckoutSnapshot = ReturnType<typeof checkoutMachine.resolveState>;

const snapshots = new WeakMap<ReviewCheckout, CheckoutSnapshot>();

/** The machine snapshot a folded checkout stands for: its state is the state value. */
export const checkoutSnapshotOf = (checkout: ReviewCheckout | undefined): CheckoutSnapshot => {
  if (checkout === undefined)
    return checkoutMachine.resolveState({ value: "absent", context: { checkout: null } });
  let snapshot = snapshots.get(checkout);

  if (snapshot === undefined) {
    snapshot = checkoutMachine.resolveState({ value: checkout.state, context: { checkout } });
    snapshots.set(checkout, snapshot);
  }

  return snapshot;
};

export interface CheckoutDecision {
  readonly events: ReadonlyArray<DomainEvent>;
  readonly rejection: string | null;
  readonly next: CheckoutSnapshot;
}

const isEmitted = (event: { readonly type: string }): event is Emitted =>
  event.type === "domain" || event.type === "rejected";

/** One input against a checkout (undefined: none yet): the events to commit, or why it is refused. */
export const decideCheckout = (
  checkout: ReviewCheckout | undefined,
  input: CheckoutInput
): CheckoutDecision => {
  const result = transition(checkoutMachine, checkoutSnapshotOf(checkout), input);
  const events: Array<DomainEvent> = [];
  let rejection: string | null = null;

  for (const action of result[1]) {
    if (action.kind !== "emit" || !isEmitted(action.event)) continue;
    const emitted = action.event;

    if (emitted.type === "domain") events.push(emitted.event);
    else rejection = emitted.reason;
  }

  return { events, rejection, next: result[0] };
};
