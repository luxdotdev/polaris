import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import { makeFakeDriver } from "../engine/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { clipTitle, draftAccept, draftPrompt, parseDraft, templateDraft } from "./draft.ts";

const input = {
  session: {
    id: SessionId.make("s1"),
    title: "Orchestrator layout prototype",
    harness: "claude" as const,
    model: null,
    effort: null,
  },
  turns: [
    { index: 21, prompt: "Prototype the Orchestrator layouts.\nMore detail", reply: "Done." },
    { index: 22, prompt: "Fix the header", reply: null },
  ],
  stat: " a.ts | 2 +-\n 1 file changed",
};

describe("drafting the commit message", () => {
  test("the template titles each Turn from its prompt and lists them", () => {
    const draft = templateDraft(input, "the agent didn't answer");

    expect(draft).toMatchObject({
      title: "Orchestrator layout prototype",
      turnTitles: ["Prototype the Orchestrator layouts", "Fix the header"],
      source: "template",
      note: "the agent didn't answer",
    });
    expect(draft.body).toBe("- Prototype the Orchestrator layouts\n- Fix the header");
    expect(draft.prBody).toContain("(Turns 22–23)");
  });

  test("titles are one line, no trailing period, at most 72 characters", () => {
    expect(clipTitle("Fix it.\nsecond line")).toBe("Fix it");
    expect(clipTitle("x".repeat(100))).toHaveLength(72);
  });

  test("the Harness's JSON is read out of its reply, the rest of the text ignored", () => {
    const reply = `Sure:\n{"title":"Fix the header.","body":"b","prTitle":"","prBody":"p","turnTitles":["One"]}`;

    expect(parseDraft(reply, 2)).toMatchObject({
      title: "Fix the header",
      prTitle: "Fix the header",
      turnTitles: ["One", "Turn 2"],
      source: "harness",
    });
    expect(parseDraft("no json here", 1)).toBeNull();
    expect(parseDraft(`{"title": ""}`, 1)).toBeNull();
  });

  test("the prompt carries the conversation, the stat and the shape asked for", () => {
    const prompt = draftPrompt(input);

    expect(prompt).toContain("Prototype the Orchestrator layouts.");
    expect(prompt).toContain("1 file changed");
    expect(prompt).toContain('"turnTitles"');
  });

  test("a Harness that never answers, or answers nothing, falls back to the template", async () => {
    const silent = makeFakeDriver("claude").driver;
    const late = await Effect.runPromise(draftAccept(silent, "/tmp", input, "20 millis"));

    expect(late).toMatchObject({ source: "template", note: "the agent took too long to answer" });

    const empty = makeFakeDriver("claude", {
      onTurn: (turn) => [
        HarnessEvent.TurnEnded({ turnId: turn.turnId, status: "failed", error: "boom" }),
      ],
    }).driver;

    const none = await Effect.runPromise(draftAccept(empty, "/tmp", input));

    expect(none).toMatchObject({ source: "template", note: "the agent didn't answer" });
  });
});
