import { describe, expect, test } from "bun:test";
import { fixedTokenizer, type TokenRun, tokensFromRuns } from "./runs.ts";

const spelled = (source: string, lines: ReadonlyArray<ReadonlyArray<TokenRun>>) =>
  tokensFromRuns(source, lines)?.map((t) => `${source.slice(t.start, t.end)}:${t.kind}`);

describe("tokens from highlighter runs", () => {
  test("merged code runs are cut into words and marks", () => {
    const source = "foo.bar(x):";

    expect(
      spelled(source, [
        [
          { text: "foo.bar", kind: "other" },
          { text: "(x):", kind: "punctuation" },
        ],
      ])
    ).toEqual([
      "foo:other",
      ".:other",
      "bar:other",
      "(:punctuation",
      "x:punctuation",
      "):punctuation",
      "::punctuation",
    ]);
  });

  test("strings and comments stay whole, trimmed, at their offsets", () => {
    const source = "a  # one two \n";

    const tokens = tokensFromRuns(source, [
      [
        { text: "a", kind: "other" },
        { text: "  # one two ", kind: "comment" },
      ],
    ]);

    expect(tokens).toEqual([
      { start: 0, end: 1, kind: "other" },
      { start: 3, end: 12, kind: "comment" },
    ]);
  });

  test("offsets run on across lines, and an empty line's newline run is skipped", () => {
    const source = "a\n\nb\n";

    expect(
      tokensFromRuns(source, [
        [{ text: "a", kind: "other" }],
        [{ text: "\n", kind: "text" }],
        [{ text: "b", kind: "keyword" }],
      ])
    ).toEqual([
      { start: 0, end: 1, kind: "other" },
      { start: 3, end: 4, kind: "keyword" },
    ]);
  });

  test("runs that don't spell the source are refused", () => {
    expect(tokensFromRuns("let a", [[{ text: "let b", kind: "other" }]])).toBeNull();
    expect(
      tokensFromRuns("a", [[{ text: "a", kind: "other" }], [{ text: "b", kind: "other" }]])
    ).toBeNull();
  });

  test("a fixed tokenizer answers by source text", () => {
    const tokens = [{ start: 0, end: 1, kind: "other" as const }];
    const tokenizer = fixedTokenizer("highlighter", [["a", tokens]]);

    expect(tokenizer.tokenize("a")).toBe(tokens);
    expect(tokenizer.tokenize("b")).toEqual([]);
  });
});
