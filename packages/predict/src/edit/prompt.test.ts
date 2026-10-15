import { expect, test } from "bun:test";
import { request } from "./fixtures.testing.ts";
import { buildEditPrompt } from "./prompt.ts";

test("Zeta renders frozen history ahead of marked regions and places the real cursor", () => {
  const input = {
    ...request,
    buffer: "a\nb\nc\nd",
    cursor: 3,
    history: [{ path: "file.ts", line: 0, before: "old", after: "a" }],
  };

  const first = buildEditPrompt(input);
  expect(first.prompt).toBe(
    "<[fim-suffix]>\n<[fim-prefix]><filename>edit_history\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+a\n\n<filename>file.ts\n<|marker_1|>a\nb<|user_cursor|>\nc\nd\n<|marker_2|>\n<[fim-middle]>"
  );
  const next = buildEditPrompt({ ...input, buffer: "a\nbb\nc\nd", cursor: 4 });
  expect(next.prompt.split("<|marker_1|>")[0]).toBe(first.prompt.split("<|marker_1|>")[0]);
});

test("Sweep includes every history hunk and reconstructs original window before the latest edit", () => {
  const result = buildEditPrompt({
    ...request,
    format: "sweep-next-edit",
    buffer: "new\nkeep",
    cursor: 3,
    history: [{ path: "file.ts", line: 0, before: "old", after: "new" }],
  });

  expect(result.prompt).toBe(
    "<|file_sep|>file.ts\n\n<|file_sep|>file.ts.diff\noriginal:\nold\nupdated:\nnew\n<|file_sep|>original/file.ts\nold\nkeep\n<|file_sep|>current/file.ts\nnew\nkeep\n<|file_sep|>updated/file.ts"
  );
  expect(result.stop).toEqual(["<|file_sep|>", "</s>", "<|endoftext|>"]);
});
