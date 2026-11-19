import { describe, expect, test } from "bun:test";
import { codeToTokens } from "@pierre/highlights";
import { highlightToHtml } from "./html.ts";
import { CodeStream, lineToHtml } from "./stream.ts";
import { HIGHLIGHT_THEMES } from "./theme.ts";

const CODE = [
  'import { x } from "./x";',
  "/* a comment",
  "   over two lines */",
  "export const port = `${x}:22`;",
  "const tag = '<b>&</b>';",
].join("\n");

/** The text a reader sees in an HTML fragment. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** The code highlighted whole, one HTML line per line. */
const wholeLines = (code: string) =>
  codeToTokens(code, { lang: "ts", theme: HIGHLIGHT_THEMES.moonlit }).tokens.map(lineToHtml);

/** A line's spans as [colour, text]. */
const spans = (html: string) =>
  [...html.matchAll(/<span style="color:([^;"]+)[^"]*">([^<]*)<\/span>/g)].map(
    ([, colour, text]) => [colour, textOf(text ?? "")]
  );

describe("highlightToHtml", () => {
  test("keeps every character and escapes markup", () => {
    const html = highlightToHtml(CODE, "ts", "moonlit");

    expect(textOf(html)).toBe(CODE);
    expect(html).not.toContain("<b>");
  });

  test("a second call leaves the first result whole", () => {
    const first = highlightToHtml(CODE, "ts", "moonlit");
    const again = highlightToHtml(CODE, "ts", "moonlit");

    highlightToHtml("fn main() {}\n".repeat(400), "rust", "light");

    expect(first).toBe(again);
  });

  test("an unknown or missing language draws plain text", () => {
    for (const lang of ["not-a-language", ""]) {
      const html = highlightToHtml("const a = 1;", lang, "moonlit");

      expect(textOf(html)).toBe("const a = 1;");
      expect(html).not.toContain("syntax-keyword");
    }
  });
});

describe("CodeStream", () => {
  test("streamed in any chunks, it draws what the whole code draws", () => {
    for (const size of [1, 3, 7, 40]) {
      const stream = new CodeStream("ts", "moonlit");

      for (let at = size; at < CODE.length; at += size) stream.update(CODE.slice(0, at));
      const { lines, tail } = stream.end(CODE);

      expect(tail).toBe("");
      expect(lines).toEqual(wholeLines(CODE));
      stream.dispose();
    }
  });

  test("a line comes back once it's complete; the rest waits as plain text", () => {
    const stream = new CodeStream("ts", "moonlit");

    expect(stream.update("const a")).toEqual({ lines: [], tail: "const a" });

    const { lines, tail } = stream.update("const a = 1;\nlet b");

    expect(lines.map(textOf)).toEqual(["const a = 1;"]);
    expect(tail).toBe("let b");
    stream.dispose();
  });

  test("text that no longer starts with what it saw starts over", () => {
    const stream = new CodeStream("ts", "moonlit");

    stream.update("const a = 1;\nconst b");
    const { lines } = stream.update("let z = 2;\n");

    expect(lines.map(textOf)).toEqual(["let z = 2;"]);
    stream.dispose();
  });

  test("a comment opened on one line still colours the next", () => {
    const stream = new CodeStream("ts", "moonlit");

    stream.update("/* open\n");
    const { lines } = stream.update("/* open\nstill comment */\n");

    expect(spans(lines[1] ?? "")).toEqual([["var(--color-syntax-comment)", "still comment */"]]);
    stream.dispose();
  });

  test("a trailing newline adds no empty line at the end", () => {
    const stream = new CodeStream("ts", "moonlit");

    expect(stream.end("a;\nb;\n").lines.map(textOf)).toEqual(["a;", "b;"]);
    expect(stream.end("a;\nb;").lines.map(textOf)).toEqual(["a;", "b;"]);
    stream.dispose();
  });
});
