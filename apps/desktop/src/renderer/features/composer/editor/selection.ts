/**
 * Chips are atomic to the caret: an arrow press crosses one whole, a click
 * never leaves the caret inside one, and copying keeps their sigils.
 */
import {
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type PointType,
  type TextNode,
} from "lexical";
import { $isCommandNode, type CommandNode } from "./node.ts";

type Direction = "left" | "right";

const $crossed = (node: TextNode, offset: number, direction: Direction): CommandNode | null => {
  if ($isCommandNode(node)) {
    const inside = direction === "right" ? offset < node.getTextContentSize() : offset > 0;

    return inside ? node : null;
  }

  const atEdge = direction === "right" ? offset === node.getTextContentSize() : offset === 0;
  const sibling = direction === "right" ? node.getNextSibling() : node.getPreviousSibling();

  return atEdge && $isCommandNode(sibling) ? sibling : null;
};

const $beyond = (chip: CommandNode, direction: Direction) => {
  const sibling = direction === "right" ? chip.getNextSibling() : chip.getPreviousSibling();
  const target = $isTextNode(sibling) && !$isCommandNode(sibling) ? sibling : chip;
  const atStart = target === chip ? direction === "left" : direction === "right";

  return { target, offset: atStart ? 0 : target.getTextContentSize() };
};

/** Moves the caret (or, extending, the focus) across a whole chip. True when it moved. */
export const $caretAcrossChip = (direction: Direction, extend: boolean): boolean => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || (!selection.isCollapsed() && !extend)) return false;
  const { focus } = selection;
  const node = focus.getNode();

  if (focus.type !== "text" || !$isTextNode(node)) return false;
  const chip = $crossed(node, focus.offset, direction);

  if (chip === null) return false;
  const { target, offset } = $beyond(chip, direction);

  if (extend) focus.set(target.getKey(), offset, "text");
  else selection.setTextNodeRange(target, offset, target, offset);

  return true;
};

/** A collapsed caret strictly inside a chip snaps to its nearer edge. */
export const $snapOutOfChip = () => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
  const { focus } = selection;
  const node = focus.getNode();

  if (focus.type !== "text" || !$isCommandNode(node)) return;
  const size = node.getTextContentSize();

  if (focus.offset === 0 || focus.offset === size) return;
  const offset = focus.offset <= size / 2 ? 0 : size;

  selection.setTextNodeRange(node, offset, node, offset);
};

const $slice = (node: TextNode, start: PointType, end: PointType) => {
  const text = node.getTextContent();
  const from = start.type === "text" && start.key === node.getKey() ? start.offset : 0;
  const to = end.type === "text" && end.key === node.getKey() ? end.offset : text.length;

  return text.slice(from, to);
};

/** The selection as text with each chip's sigil; null when it holds no chip (Lexical copies it). */
export const $selectionText = (): string | null => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || selection.isCollapsed()) return null;

  const [start, end] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];

  let chips = false;
  const parts: Array<string> = [];

  for (const node of selection.getNodes()) {
    if ($isCommandNode(node)) {
      chips = true;
      parts.push(`${node.getSigil()}${node.getTextContent()}`);
    } else if ($isLineBreakNode(node)) {
      parts.push("\n");
    } else if ($isElementNode(node)) {
      if (parts.length > 0) parts.push("\n");
    } else if ($isTextNode(node)) {
      parts.push($slice(node, start, end));
    }
  }

  return chips ? parts.join("") : null;
};
