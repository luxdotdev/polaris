import { describe, expect, test } from "bun:test";
import { failureLine, IDLE, partialMessage, suggestBlock } from "./suggest.ts";

describe("partialMessage", () => {
  test("nothing until the subject starts", () => {
    expect(partialMessage("")).toBeNull();
    expect(partialMessage('{"sub')).toBeNull();
    expect(partialMessage("Thinking about the diff")).toBeNull();
  });

  test("the subject as it streams", () => {
    expect(partialMessage('{"subject":"fix(hosts): stop ret')).toBe("fix(hosts): stop ret");
    expect(partialMessage('{"subject": "fix: a", "bo')).toBe("fix: a");
  });

  test("the body after a blank line, unescaped", () => {
    const raw = '{"subject":"fix: a","body":"Line one\\nsays \\"hi\\" \\u00e9';

    expect(partialMessage(raw)).toBe('fix: a\n\nLine one\nsays "hi" é');
  });

  test("an escape cut mid-stream is dropped, not shown", () => {
    expect(partialMessage('{"subject":"a\\')).toBe("a");
    expect(partialMessage('{"subject":"a\\u00')).toBe("a");
  });

  test("an empty body leaves the subject alone", () => {
    expect(partialMessage('{"subject":"chore: bump","body":""}')).toBe("chore: bump");
  });
});

describe("suggestBlock", () => {
  test("nothing staged says so", () => {
    expect(suggestBlock(0, false, IDLE)).toBe("Stage changes to write a message");
  });

  test("off while committing or already writing", () => {
    expect(suggestBlock(2, true, IDLE)).not.toBeNull();
    const writing = { kind: "writing", startedAt: 0, before: "", model: "m" } as const;

    expect(suggestBlock(2, false, writing)).not.toBeNull();
  });

  test("ready with staged changes", () => {
    expect(suggestBlock(1, false, IDLE)).toBeNull();
  });
});

describe("failureLine", () => {
  test("sign-in names the Harness and the Host", () => {
    expect(failureLine({ reason: "needs-sign-in", message: "" }, "Claude Code", "Linux VM")).toBe(
      "Claude Code isn't signed in on Linux VM."
    );
  });

  test("an unknown reason falls back to the Host's message", () => {
    expect(failureLine({ reason: "NotConnected", message: "Offline" }, "Codex", "Mac")).toBe(
      "Offline"
    );
  });
});
