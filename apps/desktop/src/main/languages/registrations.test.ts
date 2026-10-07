import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { LanguageRegistrations } from "./registrations.ts";

const workspace = new P.Workspace({
  id: P.WorkspaceId.make("registered"),
  path: "/registered",
  name: "registered",
  isGitRepo: true,
  worktreeRoot: "/trees",
  hidden: false,
  registeredAt: "2026-10-07T00:00:00Z",
});

const checkout = P.LanguageCheckout.cases.Workspace.make({
  workspaceId: workspace.id,
  path: workspace.path,
});

const snapshot = P.HostStreamItem.cases.Snapshot.make({
  sequence: P.Sequence.make(1),
  workspaces: [workspace],
  worktrees: [],
  sessions: [],
  reviewCheckouts: [],
});

const event = (sequence: number, value: P.DomainEvent) =>
  P.HostStreamItem.cases.Event.make({
    envelope: new P.EventEnvelope({
      sequence: P.Sequence.make(sequence),
      occurredAt: "2026-10-07T00:00:00Z",
      commandId: null,
      event: value,
    }),
  });

test("the retained Main feed observes removal and registration without another snapshot or stale resurrection", () => {
  const registry = new LanguageRegistrations();
  expect(registry.checkout(checkout)).toBe(false);
  registry.receive(snapshot);
  expect(registry.checkout(checkout)).toBe(true);
  expect(
    registry.checkout(P.LanguageCheckout.cases.Workspace.make({ ...checkout, path: "/foreign" }))
  ).toBe(false);
  registry.receive(
    event(2, P.DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: workspace.id }))
  );
  expect(registry.workspace(workspace.id)).toBe(false);
  expect(registry.checkout(checkout)).toBe(false);
  registry.receive(snapshot);
  expect(registry.checkout(checkout)).toBe(false);
  registry.receive(event(3, P.DomainEvent.cases.WorkspaceRegistered.make({ workspace })));
  expect(registry.checkout(checkout)).toBe(true);
  registry.receive(
    event(
      4,
      P.DomainEvent.cases.WorkspaceUpdated.make({
        workspace: Schema.decodeUnknownSync(P.Workspace)({
          ...Schema.encodeSync(P.Workspace)(workspace),
          path: "/moved",
        }),
      })
    )
  );
  expect(registry.checkout(checkout)).toBe(false);
});

test("Worktree and Review Checkout authorization follows removal and readiness on the live feed", () => {
  const registry = new LanguageRegistrations();
  registry.receive(snapshot);

  const tree = new P.Worktree({
    id: P.WorktreeId.make("tree"),
    workspaceId: workspace.id,
    path: "/trees/tree",
    branch: "fixture",
    head: "",
    createdBySessionId: null,
    isMain: false,
  });

  const treeCheckout = P.LanguageCheckout.cases.Worktree.make({
    workspaceId: workspace.id,
    worktreeId: tree.id,
    path: tree.path,
  });

  const review = new P.ReviewCheckout({
    id: P.ReviewCheckoutId.make("review"),
    workspaceId: workspace.id,
    subject: P.ReviewSubject.cases.SessionTurns.make({
      sessionId: P.SessionId.make("fixture"),
      firstTurnId: null,
      lastTurnId: null,
    }),
    path: "/reviews/review",
    state: "fetching",
    blocked: null,
    head: null,
    mergeBase: null,
    latestHead: "",
    latestBase: "",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
  });

  const reviewCheckout = P.LanguageCheckout.cases.ReviewCheckout.make({
    workspaceId: workspace.id,
    reviewCheckoutId: review.id,
    path: review.path,
  });

  registry.receive(event(2, P.DomainEvent.cases.WorktreeDetected.make({ worktree: tree })));
  registry.receive(event(3, P.DomainEvent.cases.ReviewCheckoutOpened.make({ checkout: review })));
  expect(registry.checkout(treeCheckout)).toBe(true);
  expect(registry.checkout(reviewCheckout)).toBe(false);

  const ready = Schema.decodeUnknownSync(P.ReviewCheckout)({
    ...Schema.encodeSync(P.ReviewCheckout)(review),
    state: "ready",
  });

  registry.receive(event(4, P.DomainEvent.cases.ReviewCheckoutChanged.make({ checkout: ready })));
  expect(registry.checkout(reviewCheckout)).toBe(true);
  registry.receive(
    event(5, P.DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: workspace.id }))
  );
  registry.receive(event(6, P.DomainEvent.cases.WorkspaceRegistered.make({ workspace })));
  expect(registry.checkout(treeCheckout)).toBe(false);
  expect(registry.checkout(reviewCheckout)).toBe(false);
});
