import { describe, expect, test } from "bun:test";
import { ApprovalDecision } from "@polaris/protocol";
import { parseQuestions, toPermissionResult } from "./permissions.ts";

const input = {
  questions: [
    {
      question: "Which scope?",
      header: "Scope",
      multiSelect: false,
      options: [{ label: "Own", description: "this session" }, { label: "Host" }],
    },
    {
      question: "Which tools?",
      header: "Tools",
      multiSelect: true,
      options: [{ label: "Search" }, { label: "Read" }],
    },
  ],
};

const answer = (text: string, answers?: ReadonlyArray<ReadonlyArray<string>>) =>
  toPermissionResult(
    ApprovalDecision.cases.Answer.make(answers === undefined ? { text } : { text, answers }),
    { toolName: "AskUserQuestion", input, suggestions: [] }
  );

describe("AskUserQuestion with several questions", () => {
  test("every question is read, with its header, descriptions and multi-select", () => {
    const questions = parseQuestions(input);

    expect(questions.map((q) => [q.header, q.question, q.multiSelect])).toEqual([
      ["Scope", "Which scope?", false],
      ["Tools", "Which tools?", true],
    ]);
    expect(questions[0]?.options.map((o) => [o.label, o.description])).toEqual([
      ["Own", "this session"],
      ["Host", null],
    ]);
  });

  test("each takes its own answer, several labels joined with a comma", () => {
    expect(answer("ignored", [["Own"], ["Search", "Read"]])).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { "Which scope?": "Own", "Which tools?": "Search, Read" },
      },
    });
  });

  test("text alone from an older Client answers one line per question", () => {
    expect(answer("Host\nRead")).toMatchObject({
      updatedInput: { answers: { "Which scope?": "Host", "Which tools?": "Read" } },
    });
  });
});
