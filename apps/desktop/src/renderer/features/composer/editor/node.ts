/**
 * A Skill or Slash Command chip: a TextNode in "token" mode, so the caret and
 * deletion take it whole. Its text is the name; the sigil is drawn as the
 * kind's icon by CSS, so caret metrics never drift (`composer.css`).
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

export type ChipKind = keyof typeof ICON_MASKS;

export type SerializedCommandNode = Spread<
  { readonly sigil: Sigil; readonly kind: ChipKind },
  SerializedTextNode
>;

export class CommandNode extends TextNode {
  __sigil: Sigil;
  __kind: ChipKind;

  static override getType(): string {
    return "composer-command";
  }

  static override clone(node: CommandNode): CommandNode {
    return new CommandNode(node.__sigil, node.__kind, node.__text, node.__key);
  }

  constructor(sigil: Sigil, kind: ChipKind, name: string, key?: NodeKey) {
    super(name, key);
    this.__sigil = sigil;
    this.__kind = kind;
  }

  getSigil(): Sigil {
    return this.getLatest().__sigil;
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

export const $createCommandNode = (sigil: Sigil, kind: ChipKind, name: string): CommandNode =>
  $applyNodeReplacement(new CommandNode(sigil, kind, name).setMode("token"));

export const $isCommandNode = (node: LexicalNode | null | undefined): node is CommandNode =>
  node instanceof CommandNode;
