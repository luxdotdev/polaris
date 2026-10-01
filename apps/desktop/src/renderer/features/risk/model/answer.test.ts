import { describe, expect, test } from "bun:test";
import { answerIn, answerOf } from "./answer.ts";

const reply = (answer: string | null) =>
  `Looked again.\n\n\`\`\`json\n${JSON.stringify({ findings: [], revised: [], withdrawn: [], answer })}\n\`\`\``;

describe("the Reviewer's answer", () => {
  test("is the last reply document's answer", () => {
    expect(answerIn(reply("Yes: line 41 still multiplies."))).toBe(
      "Yes: line 41 still multiplies."
    );
    expect(answerIn("no document here")).toBeNull();
    expect(answerIn("```json\nnot json\n```")).toBeNull();
  });

  test("waits while the Turn works", () => {
    expect(answerOf(null)).toEqual({ kind: "thinking" });
    expect(answerOf({ status: "working", messages: [reply("early")] })).toEqual({
      kind: "thinking",
    });
  });

  test("falls back to prose, then to a plain statement", () => {
    expect(answerOf({ status: "completed", messages: [reply("It's fine.")] })).toEqual({
      kind: "answered",
      text: "It's fine.",
    });
    expect(answerOf({ status: "completed", messages: [reply(null)] })).toEqual({
      kind: "answered",
      text: "Looked again.",
    });
    expect(answerOf({ status: "completed", messages: [] })).toEqual({
      kind: "answered",
      text: "No answer; the review is unchanged.",
    });
    expect(answerOf({ status: "failed", messages: [] }).kind).toBe("failed");
  });
});
