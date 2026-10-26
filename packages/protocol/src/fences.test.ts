import { expect, test } from "bun:test";
import { fencedBlocks } from "./fences.ts";

test("a fence closes only at a bare fence of its own kind, at least as long", () => {
  const text = "````md\n```ts\nx();\n```\n````\n~~~\n```\n~~~";

  expect(fencedBlocks(text).map((b) => [b.lang, b.body])).toEqual([
    ["md", "```ts\nx();\n```"],
    ["", "```"],
  ]);
});

test("a block still streaming runs to the end of the text", () => {
  expect(fencedBlocks('Done.\n\n```json\n{"answer":').map((b) => b.body)).toEqual(['{"answer":']);
});
