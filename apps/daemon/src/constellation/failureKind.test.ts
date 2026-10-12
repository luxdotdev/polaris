import { expect, test } from "bun:test";
import { classifyFailure } from "./failureKind.ts";

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
