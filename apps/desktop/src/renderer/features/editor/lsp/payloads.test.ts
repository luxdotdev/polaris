import { describe, expect, test } from "bun:test";
import { MARKDOWN } from "./hoverFixtures.testing.ts";
import { hoverParts, tidyDocs } from "./payloads.ts";

const markdown = (text: string) => tidyDocs({ kind: "markdown", text }).text;

describe("hover Markdown tidying", () => {
  test("pydoc call lines right after the rule become a code fence, unescaped", () => {
    expect(hoverParts(MARKDOWN.PYRIGHT_STR)[0]?.text).toStartWith(
      "```python\nclass str(object: object = \"\")\n```\n---\n```\nstr(object='') -> str\nstr(bytes_or_buffer[, encoding[, errors]]) -> str\n```\n\nCreate a new string"
    );
  });

  test("docs that only mention a call stay prose", () => {
    const text = "```python\nx\n```\n---\nCall greet(name) -> str to say hello.";

    expect(markdown(text)).toBe(text);
    expect(markdown("str(object) -> str\n\nNo rule before it.")).toBe(
      "str(object) -> str\n\nNo rule before it."
    );
  });

  test("empty fences and runs of blank lines go; text is trimmed", () => {
    expect(markdown("\n```python\n```\n\n\n\nDocs\n\n")).toBe("Docs");
    expect(markdown("```\n\n```")).toBe("");
    expect(hoverParts({ kind: "markdown", value: "```ts\n```" })).toEqual([]);
  });

  test("plaintext keeps its words and single blank lines", () => {
    expect(tidyDocs({ kind: "plaintext", text: "a\n\n\n\nb\n\nc  " })).toEqual({
      kind: "plaintext",
      text: "a\n\nb\n\nc",
    });
  });
});
