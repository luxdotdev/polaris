/**
 * A Skill, Slash Command or file mention chip: a TextNode in "token" mode, so
 * the caret and deletion take it whole. Its text is the name (a mention's, its
 * path); the sigil is drawn as the kind's icon by CSS (`composer.css`).
 */
import { ICON_MASKS } from "@polaris/ui";
import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import type { Sigil } from "../model/commands.ts";
import { mentionText } from "../model/mentions.ts";

export type ChipKind = keyof typeof ICON_MASKS;

/** A command's sigil, or `@` for a file or folder mention. */
export type ChipSigil = Sigil | "@";

export type SerializedCommandNode = Spread<
  { readonly sigil: ChipSigil; readonly kind: ChipKind },
  SerializedTextNode
>;

export class CommandNode extends TextNode {
  __sigil: ChipSigil;
  __kind: ChipKind;

  static override getType(): string {
    return "composer-command";
  }

  static override clone(node: CommandNode): CommandNode {
    return new CommandNode(node.__sigil, node.__kind, node.__text, node.__key);
  }

  constructor(sigil: ChipSigil, kind: ChipKind, name: string, key?: NodeKey) {
    super(name, key);
    this.__sigil = sigil;
    this.__kind = kind;
  }

  getSigil(): ChipSigil {
    return this.getLatest().__sigil;
  }

  /** What the Turn sends for it: `/name`, `$name`, or the mention's `@path`. */
  getSentText(): string {
    const sigil = this.getSigil();
    const text = this.getTextContent();

    return sigil === "@" ? mentionText(text) : `${sigil}${text}`;
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);

    dom.classList.add("composer-chip");
    dom.dataset["kind"] = this.__kind;
    dom.dataset["sigil"] = this.__sigil;
    dom.style.setProperty("--chip-icon", ICON_MASKS[this.__kind]);

    return dom;
  }

  static override importJSON(json: SerializedCommandNode): CommandNode {
    return $createCommandNode(json.sigil, json.kind, json.text).updateFromJSON(json);
  }

  override exportJSON(): SerializedCommandNode {
    return {
      ...super.exportJSON(),
      type: "composer-command",
      sigil: this.getSigil(),
      kind: this.getLatest().__kind,
    };
  }

  override isTextEntity(): true {
    return true;
  }

  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }
}

export const $createCommandNode = (sigil: ChipSigil, kind: ChipKind, name: string): CommandNode =>
  $applyNodeReplacement(new CommandNode(sigil, kind, name).setMode("token"));

export const $isCommandNode = (node: LexicalNode | null | undefined): node is CommandNode =>
  node instanceof CommandNode;
