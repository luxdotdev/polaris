import "../../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Element } from "hast";
import Review from "../../../../review/overview/ui/markdown/Rendered.tsx";
import Streamed from "../Streamed.tsx";
import { parseHtml } from "../words/Markup.tsx";
import { fenceOf } from "./CodeBlock.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const preOf = (html: string): Element => {
  const [pre] = parseHtml(html).children;

  if (pre?.type !== "element") throw new Error("expected a <pre>");

  return pre;
};

describe("the fence a <pre> holds", () => {
  test.each([
    ["a fence", '<pre><code class="language-sh">echo $HOME\n</code></pre>', "sh"],
    ["raw <pre> with no <code>", "<pre>echo $HOME</pre>", ""],
  ])("%s copies its text", (_, html, language) => {
    expect(fenceOf(preOf(html))).toEqual({ code: "echo $HOME", language, incomplete: false });
  });
});

describe("code shows as written", () => {
  test("raw <pre> in a Review shows its text", () => {
    const { container } = render(
      <TooltipProvider>
        <Review markdown={"<pre>echo $HOME</pre>"} paths={[]} renderLink={(_, c) => c} />
      </TooltipProvider>
    );

    expect(container.querySelector("pre")?.textContent).toBe("echo $HOME");
  });

  test.each([
    ["indented code", "Run:\n\n    echo $HOME"],
    ["a fence in a quote", "> ```sh\n> echo $HOME\n> ```"],
    ["an unfinished fence in a list", "- step\n\n  ```sh\n  echo $HOME"],
  ])("%s in a reply keeps its dollars", (_, markdown) => {
    const { container } = render(
      <TooltipProvider>
        <Streamed text={markdown} live={false} />
      </TooltipProvider>
    );

    expect(container.querySelector("pre")?.textContent).toBe("echo $HOME");
  });
});

const reply = (text: string, live: boolean) => (
  <TooltipProvider>
    <Streamed text={text} live={live} />
  </TooltipProvider>
);

/** The block's highlighted lines as [colour, text] runs. */
const runsOf = (code: globalThis.Element | null) =>
  [...(code?.querySelectorAll(".line") ?? [])].map((line) =>
    [...line.querySelectorAll("span[style]")].map((span) => [
      /color:\s*([^;]+)/.exec(span.getAttribute("style") ?? "")?.[1],
      span.textContent,
    ])
  );

const linesIn = (container: HTMLElement) =>
  waitFor(() => {
    const lines = container.querySelectorAll('[data-md="code-block"] code .line');

    if (lines.length === 0) throw new Error("not highlighted yet");

    return [...lines];
  });

describe("code highlights in the Editor's colours", () => {
  test("a finished fence colours its tokens and keeps its text", async () => {
    const { container } = render(reply("```ts\nconst a = 1;\n```", false));

    await linesIn(container);
    const code = container.querySelector('[data-md="code-block"] code');

    expect(code?.textContent).toBe("const a = 1;");
    expect(runsOf(code)[0]?.slice(0, 2)).toEqual([
      ["var(--color-syntax-keyword)", "const "],
      ["var(--color-text-default)", "a "],
    ]);
  });

  test("a streaming fence highlights completed lines and leaves them in place as it grows", async () => {
    const view = render(reply("```ts\nconst a = 1;\nlet b", true));
    const [first] = await linesIn(view.container);
    const code = () => view.container.querySelector('[data-md="code-block"] code');

    // The unfinished line waits as plain text, after the completed one.
    expect(code()?.textContent).toBe("const a = 1;\nlet b");
    expect(code()?.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(code()?.lastChild?.textContent).toBe("\nlet b");

    view.rerender(reply("```ts\nconst a = 1;\nlet b = 2;\nfn(", true));
    let lines = await linesIn(view.container);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(first);
    expect(code()?.textContent).toBe("const a = 1;\nlet b = 2;\nfn(");

    view.rerender(reply("```ts\nconst a = 1;\nlet b = 2;\nfn()\n```\n\nDone.", false));
    lines = await linesIn(view.container);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(first);
    expect(code()?.textContent).toBe("const a = 1;\nlet b = 2;\nfn()");
  });
});
