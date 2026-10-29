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
import type { MentionRow } from "../model/mentions.ts";
import { findTrigger, type TriggerSigil } from "../model/trigger.ts";
import { $createCommandNode, $isCommandNode, type ChipKind, type ChipSigil } from "./node.ts";

const kindOf = (option: CommandOption): ChipKind => (option.kind === "skill" ? "skill" : "command");

/** A node as the Turn reads it: a chip's sent text, a line break, or the text. */
const $textOf = (node: LexicalNode): string => {
  if ($isCommandNode(node)) return node.getSentText();

  return $isLineBreakNode(node) ? "\n" : node.getTextContent();
};

/** The draft as text, chips written as the Turn sends them in place, plus the chips in order. */
export const $readDraft = (): Draft => {
  const tokens: Array<CommandToken> = [];
  const parts: Array<string> = [];

  for (const block of $getRoot().getChildren()) {
    if (!$isElementNode(block)) continue;

    if (parts.length > 0) parts.push("\n");

    for (const child of block.getChildren()) {
      if ($isCommandNode(child))
        tokens.push({ sigil: child.getSigil(), name: child.getTextContent() });
      parts.push($textOf(child));
    }
  }

  return { text: parts.join(""), tokens };
};

/** The draft's text ahead of `node`: earlier lines, then its siblings before it. */
const $textBefore = (node: LexicalNode): string => {
  const block = node.getParent();
  const parts: Array<string> = [];

  for (const earlier of $getRoot().getChildren()) {
    if (earlier.is(block)) break;

    if ($isElementNode(earlier)) parts.push(...earlier.getChildren().map($textOf), "\n");
  }

  for (const sibling of block?.getChildren() ?? []) {
    if (sibling.is(node)) break;
    parts.push($textOf(sibling));
  }

  return parts.join("");
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
  /** The sigil word the caret is completing (`/sim`, `$`, `@src/a`). */
  readonly word: string;
  readonly sigil: TriggerSigil;
  /** The word after its sigil. */
  readonly query: string;
  readonly atHead: boolean;
}

/** The plain text node, offsets and trigger of the sigil word under a collapsed caret. */
const $wordAtCaret = () => {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { focus } = selection;
  const node = focus.getNode();

  if (focus.type !== "text" || !$isTextNode(node) || $isCommandNode(node)) return null;
  const content = node.getTextContent();
  const before = $textBefore(node) + content.slice(0, focus.offset);

  const trigger = findTrigger(before, content[focus.offset]);

  const start = focus.offset - (trigger?.word.length ?? 0);

  if (trigger === null || start < 0) return null;

  return { node, content, start, end: focus.offset, trigger };
};

/** The sigil word the caret is completing at a token start (`../model/trigger.ts`); else null. */
export const $readTypedWord = (): TypedWord | null => {
  const at = $wordAtCaret();

  if (at === null) return null;
  const { word, sigil, query } = at.trigger;

  return { word, sigil, query, atHead: $atHead(at.node, at.content.slice(0, at.start)) };
};

/** Replaces the typed word under the caret with a chip and a space after it. */
const $replaceWord = (sigil: ChipSigil, kind: ChipKind, name: string) => {
  const at = $wordAtCaret();

  if (at === null) return;
  const [first, second] = at.node.splitText(at.start, at.end);
  const target = at.start > 0 ? second : first;

  if (target === undefined) return;
  const chip = $createCommandNode(sigil, kind, name);

  target.replace(chip);
  const space = $createTextNode(" ");

  chip.insertAfter(space);
  space.select(1, 1);
};

/** Replaces the typed word under the caret with the option's chip and a space after it. */
export const $insertChip = (option: CommandOption) =>
  $replaceWord(option.sigil, kindOf(option), option.name);

/** Replaces the typed `@` word under the caret with the file or folder's mention chip. */
export const $insertMention = (row: MentionRow) => $replaceWord("@", row.kind, row.path);

/** Swaps the typed word under the caret for `text` ("" removes it: a Polaris action ran instead). */
export const $replaceTypedWord = (text: string) => {
  const at = $wordAtCaret();

  if (at === null) return;
  at.node.spliceText(at.start, at.end - at.start, text, true);
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

    const match = findComplete(node.getTextContent(), options(), $chips(), {
      before: $textBefore(node),
      atHead: $atHead(node, ""),
    });

    if (match === null) return;
    const [first, second] = node.splitText(match.start, match.start + match.length);
    const target = match.start > 0 ? second : first;

    target?.replace(
      $createCommandNode(match.option.sigil, kindOf(match.option), match.option.name)
    );
  });
