import { beforeAll, describe, expect, test } from "bun:test";
import {
  type DiffsHighlighter,
  getSharedHighlighter,
  registerCustomTheme,
  renderFileWithHighlighter,
} from "@pierre/diffs";
import { fixedTokenizer, splitLines, syntaxDiff, tokensFromRuns } from "@polaris/syntax-diff";
import { moonlitTheme, THEMES } from "../../../diffs/theme.ts";
import { runsOfLines } from "./highlightRuns.ts";

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  registerCustomTheme(THEMES.dark, () => Promise.resolve(moonlitTheme("dark")));
  registerCustomTheme(THEMES.light, () => Promise.resolve(moonlitTheme("light")));
  highlighter = await getSharedHighlighter({
    themes: [THEMES.dark, THEMES.light],
    langs: ["python", "go", "rust", "css", "markdown"],
    preferredHighlighter: "shiki-js",
  });
});

/** The tokens the diff tab gets for `text`: Pierre's highlight, as the pool's workers run it. */
const tokens = (path: string, text: string) => {
  const { code } = renderFileWithHighlighter({ name: path, contents: text }, highlighter, {
    theme: THEMES,
    tokenizeMaxLineLength: 1000,
    useTokenTransformer: false,
  });

  return tokensFromRuns(text, runsOfLines(code));
};

/** The marked text on each side, as a reader sees it. */
const marked = (path: string, before: string, after: string) => {
  const old = tokens(path, before);
  const fresh = tokens(path, after);

  if (old === null || fresh === null) throw new Error("the runs didn't spell the file");

  const tokenizer = fixedTokenizer("shiki", [
    [before, old],
    [after, fresh],
  ]);

  const patch = syntaxDiff(before, after, path, tokenizer);
  const text = (side: "old" | "new") => splitLines(side === "old" ? before : after);

  return patch.emphasis.map((e) => `${e.side}:${text(e.side)[e.line - 1]?.slice(e.start, e.end)}`);
};

describe("tokens from the highlighter", () => {
  test("Python: an added argument marks only it; a rename only the name", () => {
    expect(marked("a.py", "connect(host, port)\n", "connect(host, port, timeout=4)\n")).toEqual([
      "new:, timeout=4",
    ]);
    expect(marked("a.py", "def dial(host):\n    pass\n", "def connect(host):\n    pass\n")).toEqual(
      ["old:dial", "new:connect"]
    );
  });

  test("Python: a word changed in a string or a comment marks that word", () => {
    expect(marked("a.py", 'log("host is down")\n', 'log("host is still down")\n')).toEqual([
      "new:still",
    ]);
    expect(marked("a.py", "x = 1  # retry once\n", "x = 1  # retry twice\n")).toEqual([
      "old:once",
      "new:twice",
    ]);
  });

  test("Go: an added field marks only it; a rename only the name", () => {
    expect(
      marked(
        "a.go",
        'h := Host{Name: "pi", Port: 22}\n',
        'h := Host{Name: "pi", User: "lucas", Port: 22}\n'
      )
    ).toEqual(['new:User: "lucas",']);
    expect(marked("a.go", "func dial(h Host) error {\n", "func connect(h Host) error {\n")).toEqual(
      ["old:dial", "new:connect"]
    );
  });

  test("Rust: an added argument marks only it; a rename only the name", () => {
    expect(marked("a.rs", "connect(&host, 22);\n", "connect(&host, 22, true);\n")).toEqual([
      "new:, true",
    ]);
    expect(
      marked(
        "a.rs",
        "fn dial(host: &Host) -> Result<()> {\n",
        "fn connect(host: &Host) -> Result<()> {\n"
      )
    ).toEqual(["old:dial", "new:connect"]);
  });

  test("CSS: an added declaration marks only it; a renamed class only the name", () => {
    expect(
      marked("a.css", ".row { padding: 4px; }\n", ".row { padding: 4px; margin: 0; }\n")
    ).toEqual(["new:margin: 0;"]);
    expect(marked("a.css", ".row { padding: 4px; }\n", ".item { padding: 4px; }\n")).toEqual([
      "old:row",
      "new:item",
    ]);
  });

  test("Markdown: an edit in a sentence marks the words", () => {
    expect(
      marked(
        "a.md",
        "Keep retrying until the host answers.\n",
        "Keep retrying quietly until the host answers.\n"
      )
    ).toEqual(["new:quietly"]);
  });

  test("runs that don't spell the file give no tokens, so the line diff stands", () => {
    expect(tokensFromRuns("a\n", [[{ text: "b", kind: "other" }]])).toBeNull();
  });
});
