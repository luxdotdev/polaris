import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { sourceHeadingLine } from "./sourceHeadings.ts";

test("source fragment navigation respects duplicate slugs and ignores fenced headings", () => {
  const state = EditorState.create({
    doc: "# First\n\n```md\n# Duplicate\n```\n\n## **Duplicate**\n\nDuplicate\n---------\n\n## [Link](https://example.com)",
  });

  expect(sourceHeadingLine(state, "duplicate")).toBe(7);
  expect(sourceHeadingLine(state, "duplicate-1")).toBe(9);
  expect(sourceHeadingLine(state, "link")).toBe(12);
  expect(sourceHeadingLine(state, "missing")).toBeNull();
});
