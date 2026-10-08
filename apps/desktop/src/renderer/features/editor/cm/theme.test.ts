import { describe, expect, test } from "bun:test";
import { ensureSyntaxTree, type HighlightStyle } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { loadLanguage } from "./languages.ts";
import { moonlit } from "./theme.ts";

type Look = Readonly<Record<string, string>>;

const RULE = /\.(\S+)\s*\{([^}]*)\}/g;

/** Each class's declarations in sheet order, so a later rule wins as it does in CSS. */
const rulesOf = (style: HighlightStyle) =>
  [...(style.module?.getRules() ?? "").matchAll(RULE)].map(([, name, body]) => ({
    name: name ?? "",
    declarations: (body ?? "")
      .split(";")
      .map((part) => part.split(":").map((side) => side.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== ""),
  }));

const RULES = rulesOf(moonlit);

const cascade = (classes: string): Look => {
  const present = new Set(classes.split(" "));

  // Later entries overwrite earlier ones, as later rules do in the sheet.
  return Object.fromEntries(
    RULES.filter((rule) => present.has(rule.name)).flatMap((rule) => rule.declarations)
  );
};

const DOC = [
  "# Title",
  "## Section",
  "### Sub",
  "",
  "Some *em*, **strong**, ~~gone~~ and `code`.",
  "",
  "[link](https://polaris.dev) <https://auto.link>",
  "",
  "> quoted",
  "",
  "- item",
  "1. first",
  "",
  "---",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "```",
  "plain fence",
  "```",
  "",
  "<!-- note -->",
  "",
].join("\n");

const looksOf = (extensions: Extension, doc = DOC) => {
  const state = EditorState.create({ doc, extensions });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  const looks: Array<{ text: string; look: Look }> = [];

  if (tree !== null)
    highlightTree(tree, moonlit, (from, to, classes) =>
      looks.push({ text: doc.slice(from, to), look: cascade(classes) })
    );

  return (text: string, nth = 0) => looks.filter((entry) => entry.text === text)[nth]?.look ?? {};
};

const markdownLooks = async () => {
  const extension = await loadLanguage("markdown");

  looksOf(extension);
  // The first parse asks for the fence's grammar; the next one has it.
  await loadLanguage("typescript");
  await new Promise((resolve) => setTimeout(resolve, 20));

  return looksOf(extension);
};

const token = (name: string) => `var(--color-${name})`;

describe("moonlit Markdown", () => {
  test("headings are text-strong, stepping by weight", async () => {
    const look = await markdownLooks();

    expect(look(" Title")).toMatchObject({ color: token("text-strong"), "font-weight": "700" });
    expect(look(" Section")).toMatchObject({ color: token("text-strong"), "font-weight": "600" });
    expect(look(" Sub")).toMatchObject({ color: token("text-strong"), "font-weight": "500" });
  });

  test("markers are faint and plain, even inside a heading or emphasis", async () => {
    const look = await markdownLooks();
    const faint = { color: token("text-faint"), "font-weight": "400", "font-style": "normal" };

    for (const mark of ["#", "##", "*", "**", "~~", ">", "-", "1.", "---", "```", "`", "["])
      expect(look(mark)).toMatchObject(faint);
  });

  test("emphasis and strong are style, not hue", async () => {
    const look = await markdownLooks();

    expect(look("em")).toEqual({ "font-style": "italic" });
    expect(look("strong")).toMatchObject({ "font-weight": "600", color: token("text-strong") });
    expect(look("gone")).toEqual({ "text-decoration": "line-through" });
  });

  test("links take the type hue, URLs the string hue", async () => {
    const look = await markdownLooks();

    expect(look("link")).toMatchObject({ color: token("syntax-type") });
    expect(look("https://polaris.dev")).toMatchObject({ color: token("syntax-string") });
    expect(look("https://auto.link")).toMatchObject({ color: token("syntax-string") });
  });

  test("code spans and plain fences use the code tone; quotes are subtle", async () => {
    const look = await markdownLooks();

    expect(look("code")).toEqual({ color: token("syntax-string") });
    expect(look("plain fence")).toEqual({ color: token("syntax-string") });
    expect(look(" quoted")).toMatchObject({ color: token("text-subtle"), "font-style": "italic" });
    expect(look("<!-- note -->")).toEqual({ color: token("syntax-comment") });
  });

  test("a fence highlights in its own language", async () => {
    const look = await markdownLooks();

    expect(look("const")).toEqual({ color: token("syntax-keyword") });
    expect(look("1")).toEqual({ color: token("syntax-string") });
  });

  test("a leading --- block is YAML frontmatter, not a rule and headings", async () => {
    const look = looksOf(
      await loadLanguage("markdown"),
      "---\nname: Polaris\n# a comment\n---\n\n# Body\n"
    );

    expect(look("---\n")).toEqual({ color: token("syntax-comment") });
    expect(look("# a comment")).toEqual({ color: token("syntax-comment") });
    expect(look(" Body")).toMatchObject({ "font-weight": "700" });
  });

  test("no Markdown rule reaches for a signal colour (rule/syntax-is-moonlit)", () => {
    const colours = RULES.flatMap((rule) =>
      rule.declarations.filter(([key]) => key === "color").map(([, value]) => value)
    );

    for (const colour of colours)
      expect(colour).toMatch(/^var\(--color-(syntax-[a-z]+|text-(strong|subtle|faint))\)$/);
  });
});
