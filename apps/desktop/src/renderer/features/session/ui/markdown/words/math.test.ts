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

  test.each([
    ["indented code", "Run this:\n\n    echo $HOME \\(x\\)\n    echo $USER"],
    ["indented code after a closing fence", "```\na\n```\n    echo $HOME"],
    ["a fence in a quote", "> Try:\n>\n> ```sh\n> echo $HOME\n> ```"],
    ["an unfinished fence in a quote", "> ```sh\n> echo $HOME"],
    ["a fence in a list item", "1. Run\n\n   ```sh\n   echo $HOME\n   ```"],
    ["a fence opening a list item", "- ```sh\n  echo $HOME"],
    ["indented code in a list item", "- Run\n\n      echo $HOME"],
    ["a longer fence holding a shorter one", "````md\n```\n$x$ $HOME\n```\n$y$\n````"],
    ["a quoted fence in a list", "- note\n\n  > ~~~\n  > echo $HOME"],
  ])("%s stays as written", (_, text) => {
    expect(normalizeMath(text)).toBe(text);
  });

  test.each([
    [
      "a paragraph's indented continuation",
      "Prices:\n    $5 and $10",
      "Prices:\n    \\$5 and \\$10",
    ],
    ["a list item's paragraph", "- a\n\n  costs $5", "- a\n\n  costs \\$5"],
    [
      "text after a quoted fence's quote ends",
      "> ```\n> a\n\ncosts $5",
      "> ```\n> a\n\ncosts \\$5",
    ],
    [
      "text after a list's fence when the list ends",
      "- ```\n  a\nnow \\(x\\)",
      "- ```\n  a\nnow $x$",
    ],
    ["a fence of backticks with backticks in its info is prose", "```a`b $5", "```a`b \\$5"],
  ])("%s is prose", (_, input, output) => {
    expect(normalizeMath(input)).toBe(output);
  });
});
