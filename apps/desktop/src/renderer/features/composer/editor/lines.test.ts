import { expect, test } from "bun:test";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  createEditor,
  type LexicalNode,
} from "lexical";
import { $createCommandNode, CommandNode } from "./node.ts";
import { $onEdgeLine } from "./lines.ts";

/** Builds a prompt, puts the caret at (node index, offset), and asks both directions. */
const edges = (
  build: () => ReadonlyArray<ReadonlyArray<LexicalNode>>,
  at: { readonly block: number; readonly child?: number; readonly offset: number }
) => {
  const editor = createEditor({
    nodes: [CommandNode],
    onError: (e) => {
      throw e;
    },
  });

  let result = { up: false, down: false };

  editor.update(
    () => {
      const blocks = build().map((children) => $createParagraphNode().append(...children));

      $getRoot().append(...blocks);
      const block = blocks[at.block];
      const child = at.child === undefined ? undefined : block?.getChildAtIndex(at.child);
      const selection = $createRangeSelection();

      if (child === undefined || child === null) {
        selection.anchor.set(block?.getKey() ?? "", at.offset, "element");
        selection.focus.set(block?.getKey() ?? "", at.offset, "element");
      } else {
        selection.anchor.set(child.getKey(), at.offset, "text");
        selection.focus.set(child.getKey(), at.offset, "text");
      }

      $setSelection(selection);
      result = { up: $onEdgeLine(-1), down: $onEdgeLine(1) };
    },
    { discrete: true }
  );

  return result;
};

test("one line: the caret is on both edges wherever it is", () => {
  expect(
    edges(() => [[$createTextNode("fix the test")]], { block: 0, child: 0, offset: 4 })
  ).toEqual({ up: true, down: true });
});

test("around a line break: first line up only, second line down only", () => {
  const prompt = () => [
    [$createTextNode("first"), $createLineBreakNode(), $createTextNode("second")],
  ];

  expect(edges(prompt, { block: 0, child: 0, offset: 2 })).toEqual({ up: true, down: false });
  expect(edges(prompt, { block: 0, child: 2, offset: 2 })).toEqual({ up: false, down: true });
});

test("an empty last line after a break is the last line, not the first", () => {
  const prompt = () => [[$createTextNode("first"), $createLineBreakNode()]];

  expect(edges(prompt, { block: 0, offset: 2 })).toEqual({ up: false, down: true });
});

test("chips sit on the line like text; a second paragraph is another line", () => {
  const chip = () => [[$createCommandNode("/", "command", "compact"), $createTextNode(" now")]];

  expect(edges(chip, { block: 0, child: 1, offset: 2 })).toEqual({ up: true, down: true });

  const two = () => [[$createTextNode("a")], [$createTextNode("b")]];

  expect(edges(two, { block: 0, child: 0, offset: 1 })).toEqual({ up: true, down: false });
  expect(edges(two, { block: 1, child: 0, offset: 0 })).toEqual({ up: false, down: true });
});
