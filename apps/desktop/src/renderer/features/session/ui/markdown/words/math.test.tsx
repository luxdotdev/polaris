import "../../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import Streamed from "../Streamed.tsx";
import { normalizeMath } from "./math.ts";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const settled = { incomplete: false, html: false };

describe("math delimiters in prose become Words'", () => {
  test.each([
    ["bracketed inline math", "so \\( x^2 \\) grows", "so $x^2$ grows"],
    ["bracketed display math", "\\[\\sum_k k\\]", "$$\\sum_k k$$"],
    ["display dollars stay", "$$E = mc^2$$", "$$E = mc^2$$"],
    ["an open display block mid-stream stays", "$$\n\\frac{a}", "$$\n\\frac{a}"],
    ["a lone dollar is a dollar", "costs $5 or $HOME/$USER", "costs \\$5 or \\$HOME/\\$USER"],
    ["an escaped dollar stays escaped", "a \\$ b", "a \\$ b"],
    ["an escaped backslash before a paren is no delimiter", "a \\\\(b\\\\)", "a \\\\(b\\\\)"],
    ["brackets never pair across paragraphs", "\\(a\n\nb\\)", "\\(a\n\nb\\)"],
  ])("%s", (_, input, output) => {
    expect(normalizeMath(input, settled)).toBe(output);
  });
});

interface Case {
  readonly markdown: string;
  readonly live?: boolean;
  /** The element to read, its text (or `attribute`), and what it must say. */
  readonly selector: string;
  readonly attribute?: string;
  readonly expected: string;
}

const CASES: ReadonlyArray<readonly [string, Case]> = [
  [
    "inline code",
    { markdown: "Run `echo $HOME \\(x\\)` now", selector: "code", expected: "echo $HOME \\(x\\)" },
  ],
  [
    "a code span after an unmatched longer run",
    { markdown: "`` $a ` $HOME `", selector: "code", expected: "$HOME" },
  ],
  [
    "an unfinished code span while live",
    { markdown: "Run `echo $HOME", live: true, selector: "code", expected: "echo $HOME" },
  ],
  [
    "indented code",
    { markdown: "Run:\n\n    echo $HOME", selector: "pre", expected: "echo $HOME" },
  ],
  [
    "indented code in a quote after a list",
    { markdown: "- item\n\n>     echo $HOME", selector: "pre", expected: "echo $HOME" },
  ],
  [
    "a fence in a quote",
    { markdown: "> ```sh\n> echo $HOME\n> ```", selector: "pre", expected: "echo $HOME" },
  ],
  [
    "an unfinished fence in a quote",
    { markdown: "> ```sh\n> echo $HOME", live: true, selector: "pre", expected: "echo $HOME" },
  ],
  [
    "a fence in a list item",
    {
      markdown: "1. Run\n\n   ```sh\n   echo $HOME\n   ```",
      selector: "pre",
      expected: "echo $HOME",
    },
  ],
  [
    "an unfinished fence in a list item",
    {
      markdown: "- step\n\n  ```sh\n  echo $HOME",
      live: true,
      selector: "pre",
      expected: "echo $HOME",
    },
  ],
  [
    "a longer fence holding a shorter one",
    {
      markdown: "````md\n```\necho $HOME\n```\n````",
      selector: "pre",
      expected: "```\necho $HOME\n```",
    },
  ],
  [
    "an autolink",
    {
      markdown: "<https://example.com/$HOME>",
      selector: "a",
      attribute: "href",
      expected: "https://example.com/$HOME",
    },
  ],
  [
    "an inline link's URL",
    {
      markdown: "[x](https://e.com/?a=$b&c=\\$d)",
      selector: "a",
      attribute: "href",
      expected: "https://e.com/?a=$b&c=$d",
    },
  ],
  [
    "an inline link's title",
    {
      markdown: '[x](https://e.com "costs $5")',
      selector: "a",
      attribute: "title",
      expected: "costs $5",
    },
  ],
  [
    "escaped dollars",
    { markdown: "costs \\$5 and \\$6", selector: "p", expected: "costs $5 and $6" },
  ],
  [
    "shell variables in prose",
    { markdown: "from $HOME/$USER", selector: "p", expected: "from $HOME/$USER" },
  ],
  [
    "dollars inside inline HTML",
    { markdown: '<span title="$a$">x</span> and $b', selector: "p", expected: "x and $b" },
  ],
];

describe("text that isn't math renders and copies as written", () => {
  test.each(CASES)("%s", (_, { markdown, live = false, selector, attribute, expected }) => {
    const { container } = render(
      <TooltipProvider>
        <Streamed text={markdown} live={live} />
      </TooltipProvider>
    );

    const element = container.querySelector(selector);
    const shown = attribute === undefined ? element?.textContent : element?.getAttribute(attribute);

    expect(shown?.replace(/\n$/, "")).toBe(expected);
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });
});
