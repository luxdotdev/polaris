import "../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import Streamed from "./Streamed.tsx";

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

test("a table is as tall as its rows, never a scroll box", () => {
  const rows = Array.from({ length: 40 }, (_, row) => `| T${row} | task ${row} |`);
  const text = ["| Task | What |", "| --- | --- |", ...rows, ""].join("\n");

  const { container } = render(
    <TooltipProvider>
      <Streamed text={text} live={false} />
    </TooltipProvider>
  );

  const box = container.querySelector("table")?.parentElement;

  expect(container.querySelectorAll("tr")).toHaveLength(41);
  expect(box?.style.maxHeight).toBe("");
});

const message = (text: string, live: boolean) => (
  <TooltipProvider>
    <Streamed text={text} live={live} />
  </TooltipProvider>
);

describe("a streamed message", () => {
  test("finished blocks keep their elements as text arrives, and the open end settles in place", () => {
    const view = render(message("First paragraph.\n\nSecond par", true));
    const [first, second] = view.container.querySelectorAll("p");

    view.rerender(message("First paragraph.\n\nSecond paragraph.\n\nThird", true));
    view.rerender(message("First paragraph.\n\nSecond paragraph.\n\nThird one.", false));

    const after = view.container.querySelectorAll("p");

    expect(after).toHaveLength(3);
    expect(after[0]).toBe(first);
    expect(after[1]).toBe(second);
    expect(after[1]?.textContent).toBe("Second paragraph.");
  });

  test("unfinished syntax renders as it will end while live", () => {
    const { container } = render(message("Some **bold and `cod", true));

    expect(container.querySelector("strong code")?.textContent).toBe("cod");
  });

  test("marks itself streaming only while live, for the caret", () => {
    const view = render(message("Hello", true));

    expect(view.container.querySelector(".polaris-md")?.hasAttribute("data-streaming")).toBe(true);
    view.rerender(message("Hello", false));
    expect(view.container.querySelector(".polaris-md")?.hasAttribute("data-streaming")).toBe(false);
  });

  test("math renders as SVG; shell variables stay text", () => {
    const { container } = render(
      message("Energy \\(E = mc^2\\) and $$\\sum_k k$$, from $HOME/$USER.", false)
    );

    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2);
    expect(container.textContent).toContain("$HOME/$USER");
  });

  test("a Mermaid fence draws its diagram; one that doesn't parse shows as code", async () => {
    const { container } = render(
      message(
        "```mermaid\nflowchart LR\n A --> B\n```\n\n```mermaid\nflowchart LR\n A -->\n```",
        false
      )
    );

    await waitFor(() => expect(container.querySelector('[data-md="diagram"] svg')).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(container.querySelectorAll('[data-md="diagram"]')).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toBe("flowchart LR\n A -->");
  });
});
