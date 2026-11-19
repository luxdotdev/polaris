import "../../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, render } from "@testing-library/react";
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
