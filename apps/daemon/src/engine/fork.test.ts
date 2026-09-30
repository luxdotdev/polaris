import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { FORK_CONTEXT_BUDGET, finalReply, forkPreamble } from "./fork.ts";

describe("forkPreamble", () => {
  test("recounts the parent's Turns before the user's prompt", () => {
    const text = forkPreamble({
      parentTitle: "Fix the flaky test",
      ownWorktree: true,
      turns: [
        { prompt: "Fix the flaky test", reply: "Added a retry." },
        { prompt: "Use a fake clock instead", reply: null },
      ],
      prompt: "Try a mutex",
    });

    expect(text).toStartWith(
      '[Context from Polaris] This session is a fork of the session "Fix the flaky test"'
    );
    expect(text).toContain("new git worktree");
    expect(text).toContain("Turn 1\nUser: Fix the flaky test\nAssistant: Added a retry.");
    expect(text).toContain(
      "Turn 2\nUser: Use a fake clock instead\nAssistant: (no reply recorded)"
    );
    expect(text).toEndWith("The user's new request follows.\n\nTry a mutex");
  });

  test("keeps the newest Turns within the budget and says how many were left out", () => {
    const long = "x".repeat(1_900);
    const turns = Array.from({ length: 40 }, (_, i) => ({ prompt: `${i} ${long}`, reply: long }));
    const text = forkPreamble({ parentTitle: "p", ownWorktree: false, turns, prompt: "go" });
    expect(text.length).toBeLessThan(FORK_CONTEXT_BUDGET + 2_000);
    expect(text).toContain("Turn 40\n");
    expect(text).not.toContain("Turn 1\n");
    expect(text).toMatch(/\(\d+ earlier Turns omitted\)/);
    expect(text).toContain("shared with that session");
  });

  test("finalReply takes the last non-empty assistant message", () => {
    expect(finalReply(undefined)).toBeNull();
    expect(
      finalReply([
        TurnItem.cases.AssistantMessage.make({ id: "a", text: "first" }),
        TurnItem.cases.Reasoning.make({ id: "r", text: "hmm", startedAt: null, endedAt: null }),
        TurnItem.cases.AssistantMessage.make({ id: "b", text: "last" }),
        TurnItem.cases.AssistantMessage.make({ id: "c", text: "  " }),
      ])
    ).toBe("last");
  });
});
