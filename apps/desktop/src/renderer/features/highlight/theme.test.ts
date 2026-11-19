import { describe, expect, test } from "bun:test";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { codeToTokens, type Lang, tokenNames } from "@pierre/highlights";
import { highlightTree } from "@lezer/highlight";
import { loadLanguage } from "../editor/cm/languages.ts";
import { moonlit } from "../editor/cm/theme.ts";
import type { LanguageId } from "../editor/model/language.ts";
import { HIGHLIGHT_THEMES } from "./theme.ts";

const TOKENS_CSS = new URL("../../../../../../packages/ui/src/styles/tokens.css", import.meta.url);

/** The colour each class of the Editor's style sets, from its stylesheet. */
const editorColours = new Map(
  [...(moonlit.module?.getRules() ?? "").matchAll(/\.(\S+)\s*\{[^}]*?color:\s*([^;}]+)/g)].map(
    ([, name, colour]) => [name ?? "", (colour ?? "").trim()]
  )
);

/** Each word of `code` with the colour the Editor gives it. */
const editorLook = async (id: LanguageId, code: string) => {
  const state = EditorState.create({ doc: code, extensions: await loadLanguage(id) });
  const tree = ensureSyntaxTree(state, code.length, 5000);
  const looks = new Map<string, string>();

  if (tree !== null)
    highlightTree(tree, moonlit, (from, to, classes) => {
      const colour = classes
        .split(" ")
        .map((name) => editorColours.get(name))
        .findLast((value) => value !== undefined);

      if (colour !== undefined) looks.set(code.slice(from, to).trim(), colour);
    });

  return looks;
};

/** Each token of `code` with the colour Review's highlighter gives it. */
const reviewLook = (lang: Lang, code: string) => {
  const looks = new Map<string, string>();

  for (const line of codeToTokens(code, { lang, theme: HIGHLIGHT_THEMES.moonlit }).tokens)
    for (const token of line)
      if (token.color !== undefined) looks.set(token.content.trim(), token.color);

  return looks;
};

const SAMPLES: ReadonlyArray<{
  id: LanguageId;
  lang: Lang;
  code: string;
  words: ReadonlyArray<string>;
}> = [
  {
    id: "typescript",
    lang: "ts",
    code: 'import { x } from "./x";\n// note\nexport const port: number = 22;\nfunction start() { return true; }\nstart();\n',
    words: [
      "import",
      "from",
      '"./x"',
      "// note",
      "export",
      "const",
      "number",
      "22",
      "function",
      "start",
      "return",
      "true",
    ],
  },
  {
    id: "python",
    lang: "python",
    code: '# note\ndef start(port):\n    return "ok" if port else None\n',
    words: ["# note", "def", "start", "return", '"ok"', "if", "else", "None"],
  },
  {
    id: "rust",
    lang: "rust",
    code: '// note\nfn start(port: u16) -> String {\n    let name = "ok";\n    name.to_string()\n}\n',
    words: ["// note", "fn", "start", "u16", "String", "let", '"ok"'],
  },
];

describe("Review's colours are the Editor's", () => {
  for (const { id, lang, code, words } of SAMPLES)
    test(`${id}: keywords, strings, types, functions and comments match`, async () => {
      const editor = await editorLook(id, code);
      const review = reviewLook(lang, code);
      const both = (word: string) => [word, editor.get(word), review.get(word)];

      expect(words.map(both)).toEqual(
        words.map((word) => [word, editor.get(word), editor.get(word)])
      );
      // A word the Editor leaves uncoloured would make the comparison vacuous.
      expect(words.filter((word) => editor.get(word) === undefined)).toEqual([]);
    });
});

const LANGS: ReadonlyArray<Lang> = [
  "ts",
  "tsx",
  "css",
  "html",
  "markdown",
  "rust",
  "python",
  "json",
];

describe("the theme", () => {
  test("every colour it can paint is a Polaris token", async () => {
    const defined = new Set(
      [...(await Bun.file(TOKENS_CSS).text()).matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map(
        ([, name]) => name
      )
    );

    const code = tokenNames.map((name) => `${name}\n`).join("");
    const painted = new Set<string>();

    for (const theme of Object.values(HIGHLIGHT_THEMES))
      for (const lang of LANGS) {
        const result = codeToTokens(code, { lang, theme });

        for (const token of result.tokens.flat()) if (token.color) painted.add(token.color);
        painted.add(result.fg ?? "");
        painted.add(result.bg ?? "");
      }

    const missing = [...painted].filter((colour) => {
      const name = /^var\((--[a-z0-9-]+)\)$/.exec(colour)?.[1];

      return name === undefined || !defined.has(name);
    });

    expect(missing).toEqual([]);
  });
});
