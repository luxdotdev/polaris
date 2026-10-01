import { describe, expect, test } from "bun:test";
import { finishedTurns, sinceFor } from "./request.ts";

describe("which summary a Review asks for", () => {
  test("an Agent Session's finished Turns leave out the one in flight", () => {
    expect(finishedTurns("idle", 3)).toBe(3);
    expect(finishedTurns("working", 3)).toBe(2);
    expect(finishedTurns("needs-you", 1)).toBe(0);
    expect(finishedTurns("starting", 0)).toBe(0);
  });

  test("a checkout that moves asks for the new commits since the head it left", () => {
    expect(sinceFor("pull:x#1", "a")).toBeNull();
    expect(sinceFor("pull:x#1", "a")).toBeNull();
    expect(sinceFor("pull:x#1", "b")).toBe("a");
    expect(sinceFor("pull:x#1", "b")).toBe("a");
    expect(sinceFor("pull:x#1", "c")).toBe("b");
  });
});
