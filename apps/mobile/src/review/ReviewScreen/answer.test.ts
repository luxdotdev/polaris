import { describe, expect, test } from "bun:test";
import { type Turn, TurnItem } from "@polaris/protocol";
import { turn } from "../../thread/daemon.testing.ts";
import type { TurnEntry } from "../../thread/fold.ts";
import { answerOf } from "./answer.ts";

const at = "2026-10-29T10:00:00.000Z";

const message = (text: string) =>
  TurnItem.cases.AssistantMessage.make({ id: "m", text, startedAt: at });

const entry = (status: Turn["status"], fields: Partial<TurnEntry> = {}): TurnEntry => ({
  turn: turn(1, { status }),
  items: [],
  live: [],
  streaming: [],
  ...fields,
});

const reply = (answer: string) => `Checked.\n\n\`\`\`json\n${JSON.stringify({ answer })}\n\`\`\``;

describe("the reviewer's answer", () => {
  test("is the reply document's answer, not the prose around it", () => {
    expect(answerOf(entry("completed", { items: [message(reply("Rotate the key."))] }))).toEqual({
      kind: "answered",
      text: "Rotate the key.",
    });
  });

  test("falls back to the prose when the reviewer wrote no document", () => {
    expect(answerOf(entry("completed", { items: [message("It's a test key.")] }))).toEqual({
      kind: "answered",
      text: "It's a test key.",
    });
  });

  test("while it works, says the step it's on", () => {
    const reading = TurnItem.cases.ToolCall.make({
      id: "c",
      startedAt: at,
      name: "Read",
      kind: "read",
      title: "Read deploy/prototype.yml",
      input: {},
      output: null,
      status: "running",
    });

    expect(answerOf(entry("working", { live: [reading] }))).toEqual({
      kind: "thinking",
      step: "Read deploy/prototype.yml",
    });
  });

  test("a stopped reviewer says so", () => {
    expect(answerOf(entry("interrupted"))).toEqual({
      kind: "failed",
      text: "The reviewer was stopped.",
    });
  });
});
