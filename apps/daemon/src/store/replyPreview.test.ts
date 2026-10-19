import { expect, test } from "bun:test";
import { REPLY_PREVIEW_LENGTH, replyPreview } from "./replyPreview.ts";

test.each([
  ["# Fixed it\n\nThe **flaky** test _now_ waits.", "Fixed it The flaky test now waits."],
  ["See [the docs](https://x.example/a_b) and ![chart](c.png).", "See the docs and chart."],
  ["- [x] one\n- two\n1. three\n> quoted", "one two three quoted"],
  ["Run `bun test --watch`:\n\n```sh\nbun test\n```", "Run bun test --watch: bun test"],
  ["| a | b |\n|---|:-:|\n| 1 | 2 |", "a b 1 2"],
  [
    "Keep snake_case_names and 2 * 3 * 4 as they are.",
    "Keep snake_case_names and 2 * 3 * 4 as they are.",
  ],
  ["Line one<br>\n\n---\n\nline   two \\*literal\\*", "Line one line two *literal*"],
])("Markdown reads as plain text: %p", (markdown, plain) => {
  expect(replyPreview(markdown)).toBe(plain);
});

test("a long reply is cut on a word boundary, with an ellipsis", () => {
  const words = Array.from({ length: 60 }, (_, i) => "abc".repeat(1 + (i % 7))).join(" ");
  const preview = replyPreview(`**${words}**`)!;

  expect(preview.endsWith("…")).toBe(true);
  expect(preview.length).toBeLessThanOrEqual(REPLY_PREVIEW_LENGTH + 1);
  expect(preview.length).toBeGreaterThan(REPLY_PREVIEW_LENGTH - 10);
  expect(words.startsWith(preview.slice(0, -1))).toBe(true);
  expect(words[preview.length - 1]).toBe(" ");
});

test("a reply without readable text has no preview", () => {
  expect(replyPreview("  \n\n---\n")).toBeNull();
  expect(replyPreview("")).toBeNull();
});
