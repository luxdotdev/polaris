import { expect, test } from "bun:test";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
} from "lexical";
import { $createCommandNode, CommandNode } from "./node.ts";
import { $caretAcrossChip } from "./selection.ts";

test("from a line's start, → crosses a leading chip whole", () => {
  const editor = createEditor({
    nodes: [CommandNode],
    onError: (e) => {
      throw e;
    },
  });

  let landed: { key: string; offset: number; text: string } | null = null;

  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode(" keep the tests");

      $getRoot().append(paragraph.append($createCommandNode("/", "command", "compact"), text));
      const selection = $createRangeSelection();

      selection.anchor.set(paragraph.getKey(), 0, "element");
      selection.focus.set(paragraph.getKey(), 0, "element");
      $setSelection(selection);

      expect($caretAcrossChip("right", false)).toBe(true);
      const after = $getSelection();

      if ($isRangeSelection(after))
        landed = {
          key: after.focus.key,
          offset: after.focus.offset,
          text: after.focus.getNode().getTextContent(),
        };
    },
    { discrete: true }
  );

  expect(landed).toMatchObject({ offset: 0, text: " keep the tests" });
});
