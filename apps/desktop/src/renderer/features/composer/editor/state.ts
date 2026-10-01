/**
 * Editor-state helpers for the composer. Every `$` function runs inside
 * `editor.update()` or `read()`; the rules they apply live in `../model`.
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  TextNode,
} from "lexical";
import {
  type CommandOption,
  type CommandToken,
  type Draft,
  findComplete,
} from "../model/commands.ts";
import { $createCommandNode, $isCommandNode, type ChipKind } from "./node.ts";

const kindOf = (option: CommandOption): ChipKind => (option.kind === "skill" ? "skill" : "command");

/** The draft as text, chips written as sigil and name in place, plus the chips in order. */
export const $readDraft = (): Draft => {
  const tokens: Array<CommandToken> = [];
  const parts: Array<string> = [];

  for (const block of $getRoot().getChildren()) {
    if (!$isElementNode(block)) continue;

    if (parts.length > 0) parts.push("\n");

    for (const child of block.getChildren()) {
      if ($isCommandNode(child)) {
        const token = { sigil: child.getSigil(), name: child.getTextContent() };

        tokens.push(token);
        parts.push(`${token.sigil}${token.name}`);
      } else {
        parts.push($isLineBreakNode(child) ? "\n" : child.getTextContent());
      }
    }
  }

  return { text: parts.join(""), tokens };
};

/** Whether only chips and whitespace come before `node` in the first paragraph. */
const $atHead = (node: LexicalNode, before: string): boolean => {
  const paragraph = node.getParent();

  if (before.trim() !== "" || !$isParagraphNode(paragraph) || paragraph.getPreviousSibling())
    return false;

  for (const child of paragraph.getChildren()) {
    if (child.is(node)) return true;

    if (!$isCommandNode(child) && child.getTextContent().trim() !== "") return false;
  }

  return true;
};

export interface TypedWord {
  /** The sigil word the caret is completing (`/sim`, `$`). */
  readonly word: string;
  readonly atHead: boolean;
}

const WORD_TAIL = /[/$]\S*$/;

/** The plain text node and offsets of the sigil word under a collapsed caret. */
const $wordAtCaret = () => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { focus } = selection;
  const node = focus.getNode();

  if (focus.type !== "text" || !$isTextNode(node) || $isCommandNode(node)) return null;
  const content = node.getTextContent();
  const match = WORD_TAIL.exec(content.slice(0, focus.offset));

  if (match === null) return null;

  return { node, content, start: focus.offset - match[0].length, end: focus.offset };
};

/** The sigil word the caret is completing, on a word boundary on both sides; else null. */
export const $readTypedWord = (): TypedWord | null => {
  const at = $wordAtCaret();

  if (at === null) return null;
  const { node, content, start, end } = at;

  if (end < content.length && !/\s/.test(content[end] ?? "")) return null;

  if (start > 0 && !/\s/.test(content[start - 1] ?? "")) return null;

  // A sigil glued to a chip or to a word in the node before isn't a word start.
  if (start === 0 && !/(^|\s)$/.test(node.getPreviousSibling()?.getTextContent() ?? ""))
    return null;

  return { word: content.slice(start, end), atHead: $atHead(node, content.slice(0, start)) };
};

/** Replaces the typed word under the caret with the option's chip and a space after it. */
export const $insertChip = (option: CommandOption) => {
  const at = $wordAtCaret();

  if (at === null) return;
  const [first, second] = at.node.splitText(at.start, at.end);
  const target = at.start > 0 ? second : first;

  if (target === undefined) return;
  const chip = $createCommandNode(option.sigil, kindOf(option), option.name);

  target.replace(chip);
  const space = $createTextNode(" ");

  chip.insertAfter(space);
  space.select(1, 1);
};

/** Removes the typed word under the caret (a Polaris action ran instead). */
export const $removeTypedWord = () => {
  const at = $wordAtCaret();

  if (at === null) return;
  at.node.spliceText(at.start, at.end - at.start, "", true);
};

/** Replaces everything with plain text; `select` puts the caret at the end. */
export const $setText = (text: string, select: boolean) => {
  const root = $getRoot();
  const paragraph = $createParagraphNode();

  root.clear();

  if (text !== "") paragraph.append($createTextNode(text));
  root.append(paragraph);

  if (select) paragraph.selectEnd();
};

/** Marking text dirty re-runs the chip transform over text already in the editor. */
export const $retokenize = () => {
  for (const block of $getRoot().getChildren()) {
    if (!$isElementNode(block)) continue;

    for (const child of block.getChildren())
      if ($isTextNode(child) && !$isCommandNode(child)) child.markDirty();
  }
};

const $chips = (): Array<CommandToken> =>
  $getRoot()
    .getAllTextNodes()
    .filter($isCommandNode)
    .map((n) => ({ sigil: n.getSigil(), name: n.getTextContent() }));

/**
 * Turns a typed-through `/name ` into its chip, and a restored draft's too. A
 * node transform, so it composes with undo and IME.
 */
export const registerChips = (
  editor: LexicalEditor,
  options: () => ReadonlyArray<CommandOption>
): (() => void) =>
  editor.registerNodeTransform(TextNode, (node) => {
    if ($isCommandNode(node) || !$isParagraphNode(node.getParent())) return;
    const prev = node.getPreviousSibling();

    const match = findComplete(node.getTextContent(), options(), $chips(), {
      startsAtBoundary: prev === null || /\s$/.test(prev.getTextContent()),
      atHead: $atHead(node, ""),
    });

    if (match === null) return;
    const [first, second] = node.splitText(match.start, match.start + match.length);
    const target = match.start > 0 ? second : first;

    target?.replace(
      $createCommandNode(match.option.sigil, kindOf(match.option), match.option.name)
    );
  });
