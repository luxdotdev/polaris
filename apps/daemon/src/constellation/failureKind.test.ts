import { expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import { capacityBlocked, capacityResetsAt, classifyFailure } from "./failureKind.ts";

test("Harness failure text classifies into capacity, transport or harness, never implementation", () => {
  expect(classifyFailure("Selected model is at capacity. Please try a different model.")).toBe(
    "capacity"
  );
  expect(classifyFailure("usage limit reached until 14:00")).toBe("capacity");
  expect(classifyFailure("Recover reported MCP HTTP401 after Session reuse")).toBe("transport");
  expect(classifyFailure("connect ECONNREFUSED 127.0.0.1:63176")).toBe("transport");
  expect(classifyFailure("The Harness exited")).toBe("harness");
  expect(classifyFailure(null)).toBe("harness");
});

const limit = (
  status: "ok" | "reached",
  resetsAt: string | null,
  harness: "codex" | "claude" = "codex"
) =>
  PlanLimit.make({
    harness,
    kind: "session",
    scope: null,
    windowMinutes: 300,
    usedPercent: status === "reached" ? 100 : 40,
    status,
    resetsAt,
    observedAt: "2026-10-11T10:00:00.000Z",
    plan: null,
  });

test("a capacity block resets at the latest reached window of its own Harness, when one is known", () => {
  const now = "2026-10-11T12:00:00.000Z";

  const limits = [
    limit("reached", "2026-10-11T14:00:00.000Z"),
    limit("reached", "2026-10-13T00:00:00.000Z"),
    limit("ok", "2026-10-20T00:00:00.000Z"),
    limit("reached", "2026-10-30T00:00:00.000Z", "claude"),
    limit("reached", "2026-10-11T11:00:00.000Z"),
  ];

  expect(capacityResetsAt("codex", limits, now)).toBe("2026-10-13T00:00:00.000Z");
  expect(capacityResetsAt("codex", [limit("ok", null)], now)).toBeNull();
  expect(capacityBlocked(null)).toBe("capacity-blocked (reset time unknown)");
  expect(capacityBlocked("2026-10-13T00:00:00.000Z")).toBe(
    "capacity-blocked until 2026-10-13T00:00:00.000Z"
  );
});
