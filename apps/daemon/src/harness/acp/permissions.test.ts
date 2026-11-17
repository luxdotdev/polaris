import { ApprovalDecision } from "@polaris/protocol";
import { expect, test } from "bun:test";
import { allowOnce, permissionResponse } from "./permissions.ts";
import type * as P from "./protocol.ts";

const ONCE: P.PermissionOption = { optionId: "once", name: "Allow", kind: "allow_once" };

const ALWAYS: P.PermissionOption = {
  optionId: "always",
  name: "Always allow",
  kind: "allow_always",
};

const REJECT: P.PermissionOption = { optionId: "no", name: "Reject", kind: "reject_once" };

const picked = (response: P.PermissionResponse | null) =>
  response?.outcome.outcome === "selected" ? response.outcome.optionId : response?.outcome.outcome;

test("an Allow that isn't remembered never picks the agent's always-allow", () => {
  const allow = ApprovalDecision.cases.Allow.make({ remember: false });

  expect(picked(permissionResponse([ONCE, ALWAYS, REJECT], allow))).toBe("once");
  expect(picked(permissionResponse([ALWAYS, REJECT], allow))).toBe("cancelled");
});

test("a remembered Allow picks always-allow", () => {
  const allow = ApprovalDecision.cases.Allow.make({ remember: true });

  expect(picked(permissionResponse([ONCE, ALWAYS], allow))).toBe("always");
});

test("the permission mode allows once only, and asks when the agent offers no once-only allow", () => {
  expect(picked(allowOnce([ALWAYS, ONCE]))).toBe("once");
  expect(allowOnce([ALWAYS, REJECT])).toBeNull();
});
