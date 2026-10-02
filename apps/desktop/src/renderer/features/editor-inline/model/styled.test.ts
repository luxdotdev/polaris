import { describe, expect, test } from "bun:test";
import { styledLines } from "./styled.ts";

describe("styledLines", () => {
  test("keeps unstyled text between spans", () => {
    expect(styledLines("const a = 1;", [{ from: 0, to: 5, className: "kw" }])).toEqual([
      [
        { text: "const", className: "kw" },
        { text: " a = 1;", className: null },
      ],
    ]);
  });

  test("a span across a line break splits into both lines", () => {
    expect(styledLines("`a\nb` x", [{ from: 0, to: 5, className: "str" }])).toEqual([
      [{ text: "`a", className: "str" }],
      [
        { text: "b`", className: "str" },
        { text: " x", className: null },
      ],
    ]);
  });

  test("an empty line stays a line", () => {
    expect(styledLines("a\n\nb", [])).toEqual([
      [{ text: "a", className: null }],
      [],
      [{ text: "b", className: null }],
    ]);
  });
});
