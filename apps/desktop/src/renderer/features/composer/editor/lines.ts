/**
 * Whether the caret is on the prompt's first line (for ↑) or last (for ↓), so message
 * history takes the arrow only where moving the caret couldn't: no line break between the
 * caret and that end, and no wrapped row either.
 */
import {
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isRootNode,
  type LexicalNode,
} from "lexical";

/** -1 looks toward the prompt's start (↑), 1 toward its end (↓). */
export type Toward = 1 | -1;

const breaks = (nodes: ReadonlyArray<LexicalNode>) =>
  nodes.some((n) => $isLineBreakNode(n) || $isElementNode(n) || n.getTextContent().includes("\n"));

/** A line break between `node` and the prompt's end in that direction, outside `node` itself. */
const $breakBeyond = (node: LexicalNode, toward: Toward): boolean => {
  for (let at: LexicalNode | null = node; at !== null && !$isRootNode(at); at = at.getParent())
    if (breaks(toward === -1 ? at.getPreviousSiblings() : at.getNextSiblings())) return true;

  return false;
};

/** The caret has no line break between it and the prompt's start (-1) or end (1). */
export const $onEdgeLine = (toward: Toward): boolean => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const { offset, type } = selection.anchor;
  const node = selection.anchor.getNode();

  if (type === "text") {
    const text = node.getTextContent();
    const side = toward === -1 ? text.slice(0, offset) : text.slice(offset);

    return !side.includes("\n") && !$breakBeyond(node, toward);
  }

  const children = $isElementNode(node) ? node.getChildren() : [];
  const side = toward === -1 ? children.slice(0, offset) : children.slice(offset);

  return !breaks(side) && !$breakBeyond(node, toward);
};

/** The DOM caret is on the first (-1) or last (1) row the prompt wraps to. */
export const onEdgeRow = (root: HTMLElement, toward: Toward): boolean => {
  const selection = root.ownerDocument.getSelection();

  if (selection === null || selection.rangeCount === 0) return true;
  const caret = selection.getRangeAt(0);
  const side = root.ownerDocument.createRange();

  side.selectNodeContents(root);

  if (toward === -1) side.setEnd(caret.startContainer, caret.startOffset);
  else side.setStart(caret.endContainer, caret.endOffset);
  const rects = [...side.getClientRects()].filter((r) => r.width > 0);
  const first = rects[0];

  return first === undefined || rects.every((r) => Math.abs(r.top - first.top) < first.height / 2);
};
