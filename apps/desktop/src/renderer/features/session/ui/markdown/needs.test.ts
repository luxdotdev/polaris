import { describe, expect, test } from "bun:test";
import { needsOf } from "./needs.ts";

describe("Markdown plugin needs", () => {
  test("plain prose needs nothing", () => {
    expect(needsOf("Fixed it. Run `bun test` to check; it costs $5.")).toEqual({
      code: false,
      mermaid: false,
      math: false,
    });
  });

  test("a fence needs Shiki; a mermaid fence Mermaid too", () => {
    expect(needsOf("Here:\n```ts\nconst a = 1;\n```")).toMatchObject({
      code: true,
      mermaid: false,
    });
    expect(needsOf("```mermaid\ngraph LR\n  A --> B")).toMatchObject({ code: true, mermaid: true });
  });

  test("display or bracketed math needs KaTeX", () => {
    expect(needsOf("$$E = mc^2$$").math).toBe(true);
    expect(needsOf("so \\(x^2\\) grows").math).toBe(true);
  });
});
