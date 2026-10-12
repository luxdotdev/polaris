import { expect, test } from "bun:test";
import { failureReason } from "./failureCopy.ts";

test("capacity refusal says every Host language-server slot is in active use", () => {
  expect(failureReason("process-limit", "This Mac")).toBe(
    "Every language-server slot on This Mac is in active use."
  );
  expect(failureReason("process-limit", "Pi")).toBe(
    "Every language-server slot on Pi is in active use."
  );
  expect(failureReason("queue-full", "This Mac")).toBe(
    "Language tools are busy. Try again in a moment."
  );
});
