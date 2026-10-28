import { expect, test } from "bun:test";
import { Command, SessionPlacement } from "./commands.ts";
import { decideDeviceAccess } from "./deviceGrants.ts";
import { ReviewCheckoutId, SessionId, WorkspaceId } from "./ids.ts";

const outcome = (rpc: string, tag: string | null, command: Command | null = null) =>
  decideDeviceAccess(rpc, tag, command)?.what ?? "allowed";

test("a Linked Device may send the Mobile App's Commands", () => {
  expect(outcome("dispatch", "SendTurn")).toBe("allowed");
  expect(outcome("dispatch", "RespondToApproval")).toBe("allowed");
});

// RX2-1: `dispatch` is decided by its Command, and anything unnamed is refused.
test.each([
  ["dispatch", "RunShellCommand", "dispatch:RunShellCommand"],
  ["dispatch", "FutureCommand", "dispatch:FutureCommand"],
  ["dispatch", "constructor", "dispatch:constructor"],
  ["dispatch", null, "dispatch:"],
  ["voice.setKey", null, "voice.setKey"],
  ["future.newRpc", null, "future.newRpc"],
])("a Linked Device is refused %s %s", (rpc, command, refused) => {
  expect(outcome(rpc, command)).toBe(refused);
});

type StartSession = typeof Command.cases.StartSession.Type;

/** StartSession as the Mobile App builds it (`apps/mobile/src/newSession/model.ts`). */
const start = (fields: Partial<StartSession> = {}) =>
  outcome(
    "dispatch",
    "StartSession",
    Command.cases.StartSession.make({
      sessionId: SessionId.make("s1"),
      workspaceId: WorkspaceId.make("w1"),
      harness: "claude",
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "plan",
      model: null,
      effort: null,
      prompt: "hi",
      attachments: [],
      ...fields,
    })
  );

const newWorktree = SessionPlacement.cases.NewWorktree.make({
  branch: "polaris/hi-s1",
  baseRef: null,
});

// RX3-1, ENG-458: a phone starts a session in any mode the Mobile App offers.
test.each<[string, Partial<StartSession>]>([
  ["plan, in place", {}],
  ["supervised, in a new worktree", { permissionMode: "supervised", placement: newWorktree }],
  ["auto-edits", { permissionMode: "auto-edits" }],
  ["auto", { permissionMode: "auto" }],
  ["full-access", { permissionMode: "full-access" }],
  ["a null tier and origin", { serviceTier: null, origin: null }],
])("a Linked Device may start a session: %s", (_, fields) => {
  expect(start(fields)).toBe("allowed");
});

test.each<[string, Partial<StartSession>]>([
  ["a reviewer origin", { origin: "reviewer" }],
  ["a walkthrough origin", { origin: "walkthrough" }],
  ["an effort", { effort: "high" }],
  ["a service tier", { serviceTier: "priority" }],
  [
    "a base ref",
    {
      placement: SessionPlacement.cases.NewWorktree.make({ ...newWorktree, baseRef: "main" }),
    },
  ],
  [
    "an existing worktree",
    { placement: SessionPlacement.cases.ExistingWorktree.make({ path: "/etc" }) },
  ],
  [
    "a review checkout",
    {
      placement: SessionPlacement.cases.ReviewCheckout.make({
        checkoutId: ReviewCheckoutId.make("c1"),
      }),
    },
  ],
])("a Linked Device is refused a session with %s", (_, fields) => {
  expect(start(fields)).toBe("dispatch:StartSession");
});

test("a StartSession the gate couldn't decode is refused", () => {
  expect(outcome("dispatch", "StartSession", null)).toBe("dispatch:StartSession");
});
