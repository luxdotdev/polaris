import { describe, expect, test } from "bun:test";
import { stripSessionLines } from "./strip-session-trailer.ts";

describe("stripSessionLines", () => {
  test("drops Claude-Session trailers and session URLs", () => {
    const message = [
      "Add the lint ratchet",
      "",
      "Body.",
      "",
      "Claude-Session: https://claude.ai/code/session_01ABC",
      "https://claude.ai/code/session_01ABC",
      "",
    ].join("\n");

    expect(stripSessionLines(message)).toBe("Add the lint ratchet\n\nBody.\n");
  });

  test("leaves other messages untouched", () => {
    expect(stripSessionLines("Fix a bug\n\nSee https://claude.ai/docs\n")).toBeNull();
  });
});
