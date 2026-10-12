import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DocView, loadDocRenderer, mountDocs } from "./docs.tsx";
import { MARKDOWN, PLAINTEXT } from "./hoverFixtures.testing.ts";
import { hoverParts } from "./payloads.ts";

const LABEL = "TypeScript · bundled";

const view = (contents: Parameters<typeof hoverParts>[0]) =>
  render(
    <DocView docs={{ sections: [hoverParts(contents)], footnote: LABEL, variant: "hover" }} />
  );

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

  return loadDocRenderer();
});

// Shiki arrives after the first fence; let it land before the DOM goes away.
afterEach(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  cleanup();
});

describe("language docs: hover", () => {
  test("a Markdown fence renders as a code block, without its fence marks", async () => {
    const { container } = view({
      kind: "markdown",
      value:
        "```typescript\nfunction sleep(ms: number): Promise<void>\n```\nWaits *ms* milliseconds.",
    });

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.textContent).toContain("function sleep(ms: number): Promise<void>");
    expect(container.textContent).not.toContain("```");
    expect(container.querySelector("em")?.textContent).toBe("ms");
    expect(container.querySelector("[data-docs-footnote]")?.textContent).toBe(LABEL);
    expect(container.firstElementChild?.lastElementChild?.hasAttribute("data-docs-footnote")).toBe(
      true
    );
  });

  test("a {language, value} marked string is code too", async () => {
    const { container } = view([{ language: "ts", value: "const a: 1" }, "Docs"]);

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.textContent).not.toContain("```");
  });

  test("plaintext stays as written", () => {
    const { container } = view({ kind: "plaintext", value: "**not bold** ```x```" });

    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**not bold** ```x```");
  });

  test("server HTML is never injected and links never navigate the app", async () => {
    const { container } = view({
      kind: "markdown",
      value:
        'Text <script>globalThis.__hoverInjected = true</script> <img src="x" onerror="globalThis.__hoverInjected = true"> [docs](https://example.com) [local](file:///etc/passwd) [js](javascript:alert(1))',
    });

    await waitFor(() => expect(container.querySelector("a")).not.toBeNull());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect("__hoverInjected" in globalThis).toBe(false);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/"]);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
  });

  test("mountDocs fills the tooltip synchronously and unmounts on destroy", async () => {
    const dom = document.createElement("div");

    const mounted = mountDocs(dom, {
      sections: [hoverParts("plain words")],
      footnote: LABEL,
      variant: "hover",
    });

    expect(dom.textContent).toContain("plain words");
    mounted.destroy();
    await Promise.resolve();
    expect(dom.textContent).toBe("");
  });

  test("basedpyright's str: the signature, a rule, pydoc lines as code, then prose", async () => {
    const { container } = view(MARKDOWN.PYRIGHT_STR);

    await waitFor(() => expect(container.querySelectorAll("pre")).toHaveLength(2));

    // Shiki renders each line as its own block span.
    const [signature, pydoc] = [...container.querySelectorAll("pre")].map((pre) =>
      [...pre.querySelectorAll("code > span")].map((line) => line.textContent)
    );

    expect(signature).toEqual(['class str(object: object = "")']);
    expect(pydoc).toEqual([
      "str(object='') -> str",
      "str(bytes_or_buffer[, encoding[, errors]]) -> str",
    ]);
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toStartWith("Create a new string object");
    expect(container.textContent).not.toContain("&gt;");
  });

  test("a docstring's Example fence is code; its Args stay prose", async () => {
    const { container } = view(MARKDOWN.PYRIGHT_FUNCTION);

    await waitFor(() => expect(container.querySelectorAll("pre")).toHaveLength(2));
    expect(container.querySelector("pre")?.textContent).toStartWith("(function) def greet(");
    expect([...container.querySelectorAll("pre")].at(-1)?.textContent).toContain(
      ">>> greet('Ada')"
    );
    expect(container.textContent).toContain("Args:");
  });

  test("TypeScript's leading newline and fence render as one code block with no empty blocks", async () => {
    const { container } = view(MARKDOWN.TS_FUNCTION);

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());

    const blocks = [...container.querySelectorAll('[data-streamdown="code-block"]')];

    expect(blocks).toHaveLength(1);
    expect(blocks.every((block) => (block.textContent ?? "").trim() !== "")).toBe(true);
    expect(container.querySelectorAll("p")).toHaveLength(3);
  });

  test("older Daemons' plaintext keeps its lines, without runs of blank lines", () => {
    const { container } = view(PLAINTEXT.PYRIGHT_STR);

    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain("str(object='') -> str");
    expect(container.querySelector("p")?.textContent).not.toMatch(/\n\s*\n\s*\n/);
  });
});
