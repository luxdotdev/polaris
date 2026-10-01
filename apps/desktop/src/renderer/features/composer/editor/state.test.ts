import { describe, expect, test } from "bun:test";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import type { CommandOption } from "../model/commands.ts";
import { $isCommandNode, CommandNode } from "./node.ts";
import { $insertChip, $readDraft, $readTypedWord, $setText, registerChips } from "./state.ts";

const option = (name: string, extra: Partial<CommandOption> = {}): CommandOption => ({
  name,
  sigil: "/",
  description: "",
  argumentHint: null,
  kind: "command",
  source: "built-in",
  plugin: null,
  run: "text",
  action: null,
  template: null,
  ...extra,
});

const OPTIONS = [
  option("compact"),
  option("simplify", { kind: "skill" }),
  option("tdd", { sigil: "$" }),
];

const editorWith = (text: string) => {
  const editor = createEditor({
    nodes: [CommandNode],
    onError: (e) => {
      throw e;
    },
  });

  registerChips(editor, () => OPTIONS);
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      const node = $createTextNode(text);

      $getRoot().append(paragraph.append(node));
      node.select(text.length, text.length);
    },
    { discrete: true }
  );

  return editor;
};

const chips = (editor: ReturnType<typeof createEditor>) =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getAllTextNodes()
      .filter($isCommandNode)
      .map((n) => `${n.getSigil()}${n.getTextContent()}`)
  );

describe("chips in the editor", () => {
  test("a typed-through listed command becomes a chip, and the draft keeps its sigil", () => {
    const editor = editorWith("/compact keep the tests");

    expect(chips(editor)).toEqual(["/compact"]);
    expect(editor.getEditorState().read($readDraft)).toEqual({
      text: "/compact keep the tests",
      tokens: [{ sigil: "/", name: "compact" }],
    });
  });

  test("a / command only at the head; a $ Skill anywhere", () => {
    expect(chips(editorWith("please /compact now"))).toEqual([]);
    expect(chips(editorWith("use $tdd here"))).toEqual(["$tdd"]);
  });

  test("picking from the menu swaps the typed word for the chip and a space", () => {
    const editor = editorWith("/sim");

    expect(editor.getEditorState().read($readTypedWord)).toEqual({ word: "/sim", atHead: true });
    editor.update(() => $insertChip(OPTIONS[1] ?? option("x")), { discrete: true });

    expect(chips(editor)).toEqual(["/simplify"]);
    expect(editor.getEditorState().read($readDraft).text).toBe("/simplify ");
  });

  test("a restored draft gets its chips back", () => {
    const editor = editorWith("");

    editor.update(() => $setText("/simplify the parser", false), { discrete: true });

    expect(chips(editor)).toEqual(["/simplify"]);
  });

  test("a word glued to text isn't a command word", () => {
    expect(editorWith("src/sim").getEditorState().read($readTypedWord)).toBeNull();
  });
});
