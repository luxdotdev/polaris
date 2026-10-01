import { describe, expect, test } from "bun:test";
import {
  DomainEvent,
  PullRequestRef,
  RepoRef,
  ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCheckoutId,
  ReviewSubject,
  WorkspaceId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { type CheckoutInput, checkoutMachine, decideCheckout } from "./checkout.ts";

const at = "2026-10-01T00:00:00.000Z";

const opened = new ReviewCheckout({
  id: ReviewCheckoutId.make("rc"),
  workspaceId: WorkspaceId.make("ws"),
  subject: ReviewSubject.cases.PullRequest.make({
    pullRequest: new PullRequestRef({
      repo: new RepoRef({ host: "github.com", owner: "acme", name: "app" }),
      number: 1,
    }),
    baseRef: "main",
  }),
  path: "/repo.worktrees/.review/pr-1",
  state: "fetching",
  blocked: null,
  head: null,
  mergeBase: null,
  latestHead: "h1",
  latestBase: "b1",
  reviewedHead: null,
  reviewedMergeBase: null,
  openedAt: at,
  updatedAt: at,
});

/** Apply inputs in order, folding each accepted change as the store would. */
const drive = (inputs: ReadonlyArray<CheckoutInput>) => {
  let checkout: ReviewCheckout | undefined;
  const rejections: Array<string | null> = [];
  const events: Array<DomainEvent> = [];

  for (const input of inputs) {
    const decision = decideCheckout(checkout, input);
    rejections.push(decision.rejection);
    events.push(...decision.events);

    for (const event of decision.events) {
      if (Predicate.isTagged(event, "ReviewCheckoutRemoved")) checkout = undefined;
      else if ("checkout" in event) checkout = event.checkout;
    }

    // The machine's next state is always the folded checkout's own state.
    expect(decision.next.value).toBe(checkout?.state ?? "absent");
  }

  return { checkout, rejections, events };
};

const fetched = (head: string): CheckoutInput => ({
  type: "checkout.fetched",
  head,
  mergeBase: "m1",
  at,
});

const dirty = new ReviewCheckoutBlock({
  during: "remove",
  blocker: ReviewCheckoutBlocker.cases.Dirty.make({ paths: ["a.ts"] }),
});

describe("the Review Checkout machine", () => {
  test("fetching → ready → stale on a new head → fetching on update → ready", () => {
    const { checkout, rejections } = drive([
      { type: "checkout.open", checkout: opened },
      fetched("h1"),
      { type: "checkout.reportHead", head: "h2", base: "b1", at },
      { type: "checkout.update", discardChanges: false, at },
      fetched("h2"),
    ]);

    expect(rejections.every((r) => r === null)).toBe(true);
    expect(checkout?.state).toBe("ready");
    expect(checkout?.head).toBe("h2");
  });

  test("a fetch that lands behind the code host is stale at once; update at the latest head is a no-op", () => {
    const behind = drive([
      { type: "checkout.open", checkout: opened },
      { type: "checkout.reportHead", head: "h2", base: "b1", at },
      fetched("h1"),
    ]);

    expect(behind.checkout?.state).toBe("stale");

    const current = drive([
      { type: "checkout.open", checkout: opened },
      fetched("h1"),
      { type: "checkout.update", discardChanges: false, at },
    ]);

    expect(current.checkout?.state).toBe("ready");
    expect(current.events.length).toBe(2);
  });

  test("removal: blocked while dirty, then removed; signals for other states change nothing", () => {
    const { checkout, rejections, events } = drive([
      { type: "checkout.open", checkout: opened },
      { type: "checkout.removed" },
      fetched("h1"),
      { type: "checkout.remove", at },
      { type: "checkout.blocked", block: dirty, at },
      { type: "checkout.remove", at },
      { type: "checkout.update", discardChanges: false, at },
      { type: "checkout.removed" },
    ]);

    expect(rejections).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "the Review Checkout is being removed",
      null,
    ]);
    expect(checkout).toBeUndefined();
    expect(events.at(-1)?._tag).toBe("ReviewCheckoutRemoved");
    expect(events.filter((e) => Predicate.isTagged(e, "ReviewCheckoutChanged")).length).toBe(4);
  });

  test("refusals: a second open, anything before open, update while fetching", () => {
    expect(
      drive([
        { type: "checkout.open", checkout: opened },
        { type: "checkout.open", checkout: opened },
        { type: "checkout.update", discardChanges: false, at },
      ]).rejections
    ).toEqual([
      null,
      "Review Checkout rc is already open",
      "the Review Checkout is already being fetched",
    ]);

    expect(drive([{ type: "checkout.remove", at }]).rejections).toEqual([
      "there is no such Review Checkout",
    ]);
  });

  test("the reviewed head is recorded in any state", () => {
    const { checkout } = drive([
      { type: "checkout.open", checkout: opened },
      fetched("h1"),
      { type: "checkout.reviewed", head: "h1", mergeBase: "m1", at },
    ]);

    expect(checkout?.reviewedHead).toBe("h1");
    expect(checkout?.state).toBe("ready");
  });

  test("its states are the Review Checkout States, and absent", () => {
    expect(Object.keys(checkoutMachine.root.states).toSorted()).toEqual([
      "absent",
      "blocked",
      "fetching",
      "ready",
      "removing",
      "stale",
    ]);
  });
});
