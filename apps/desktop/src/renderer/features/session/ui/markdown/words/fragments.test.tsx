import "../../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import Review from "../../../../review/overview/ui/markdown/Rendered.tsx";
import Streamed from "../Streamed.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const NOTE = "Replays are rare[^1].\n\n[^1]: Past 500 frames.";

const VIEWS: ReadonlyArray<readonly [string, (markdown: string) => ReactNode]> = [
  ["the transcript", (markdown) => <Streamed text={markdown} live={false} />],
  [
    "the Review overview",
    (markdown) => <Review markdown={markdown} paths={[]} renderLink={(_, children) => children} />,
  ],
];

/** Clicks the link and returns the element it scrolled to, if any. */
const follow = (link: Element | null): Element | null => {
  const reached: Array<Element> = [];

  HTMLElement.prototype.scrollIntoView = mock(function (this: Element) {
    reached.push(this);
  });

  if (link !== null) fireEvent.click(link);

  return reached[0] ?? null;
};

describe.each(VIEWS)("footnotes in %s", (_, view) => {
  test("the reference reaches its note and the note's backlink returns, the app's route kept", () => {
    const hash = location.hash;
    const { container } = render(<TooltipProvider>{view(NOTE)}</TooltipProvider>);
    const reference = container.querySelector("sup a");
    const note = container.querySelector(".footnotes li");
    const back = note?.querySelector("a") ?? null;

    expect(follow(reference)).toBe(note);
    expect(follow(back)).toBe(reference);
    expect(location.hash).toBe(hash);
  });
});
