import { expect, test } from "bun:test";
import { Schema } from "effect";
import { InlinePatch, InlineRequest, inlineSessionPrompt } from "./inline.ts";
import { WorkspaceId } from "./ids.ts";

test("inline patch rejects invalid offsets and missing or oversized summaries", () => {
  const decode = Schema.decodeUnknownSync(InlinePatch);

  for (const from of [-1, 1.5])
    expect(() => decode({ replacements: [{ from, to: 2, text: "x" }], summary: "Edit" })).toThrow();

  for (const summary of [undefined, "", "x".repeat(501)])
    expect(() => decode({ replacements: [], summary })).toThrow();
});

test("session conversion preserves the exact unsaved selection and proposal", () => {
  const request = InlineRequest.make({
    workspaceId: WorkspaceId.make("w"),
    path: "/repo/a.ts",
    content: "before unsaved after",
    selection: { from: 7, to: 14 },
    prompt: "Change this",
    harness: "codex",
    model: null,
    effort: null,
  });

  const patch = InlinePatch.make({
    replacements: [{ from: 7, to: 14, text: "saved" }],
    summary: "Replace",
  });

  const prompt = inlineSessionPrompt(request, patch);

  expect(prompt).toContain('"text":"unsaved"');

  expect(prompt).toContain(JSON.stringify(patch));

  expect(prompt).toContain(request.prompt);
});
