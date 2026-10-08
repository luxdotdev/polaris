import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { HoverView, loadHoverRenderer, mountHover } from "./hoverContent.tsx";
import { hoverParts } from "./payloads.ts";

const LABEL = "TypeScript · bundled";

const view = (contents: Parameters<typeof hoverParts>[0]) =>
  render(<HoverView sections={[{ label: LABEL, parts: hoverParts(contents) }]} />);

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

  return loadHoverRenderer();
});

// Shiki arrives after the first fence; let it land before the DOM goes away.
afterEach(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  cleanup();
});

describe("hover content", () => {
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
    expect(container.textContent).toContain(LABEL);
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

  test("mountHover fills the tooltip synchronously and unmounts on destroy", async () => {
    const dom = document.createElement("div");
    const mounted = mountHover(dom, [{ label: LABEL, parts: hoverParts("plain words") }]);

    expect(dom.textContent).toContain("plain words");
    mounted.destroy();
    await Promise.resolve();
    expect(dom.textContent).toBe("");
  });
});
