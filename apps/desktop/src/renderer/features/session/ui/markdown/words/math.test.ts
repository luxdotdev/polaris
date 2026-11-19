import { describe, expect, test } from "bun:test";
import { normalizeMath } from "./math.ts";

describe("math delimiters for Words", () => {
  test.each([
    ["bracketed inline math", "so \\( x^2 \\) grows", "so $x^2$ grows"],
    ["bracketed display math", "\\[\\sum_k k\\]", "$$\\sum_k k$$"],
    ["display dollars stay", "$$E = mc^2$$", "$$E = mc^2$$"],
    ["an open display block mid-stream stays", "$$\n\\frac{a}", "$$\n\\frac{a}"],
    ["a lone dollar is a dollar", "costs $5 or $HOME/$USER", "costs \\$5 or \\$HOME/\\$USER"],
    ["an escaped dollar stays escaped", "a \\$ b", "a \\$ b"],
  ])("%s", (_, input, output) => {
    expect(normalizeMath(input)).toBe(output);
  });

  test("code is left as written, fenced or inline", () => {
    const text = "Run `echo $HOME \\(x\\)` then\n\n```sh\necho $PATH \\[y\\]\n```\n\nand \\(z\\)";

    expect(normalizeMath(text)).toBe(
      "Run `echo $HOME \\(x\\)` then\n\n```sh\necho $PATH \\[y\\]\n```\n\nand $z$"
    );
  });

  test("an unclosed fence keeps everything after it as code", () => {
    expect(normalizeMath("~~~\n$x$\n```\n$y$")).toBe("~~~\n$x$\n```\n$y$");
  });
});
