import { expect, test } from "bun:test";
import { decideDeviceAccess } from "./deviceGrants.ts";

const outcome = (rpc: string, command: string | null) =>
  decideDeviceAccess(rpc, command)?.what ?? "allowed";

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
