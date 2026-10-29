import "../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { SummaryGlyph } from "./glyphs.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const summary = (state: "working" | "starting" | "idle") =>
  ({ state, harness: "claude", needsYou: 0, sessions: 1 }) as const;

describe("a Workspace chip's glyph", () => {
  test.each(["working", "starting"] as const)("is a still dot, no dither, while %s", (state) => {
    const { container, getByRole } = render(<SummaryGlyph summary={summary(state)} />);

    expect(container.querySelector(".polaris-dither")).toBeNull();
    expect(getByRole("img").getAttribute("aria-label")).toBe(
      state === "working" ? "Working" : "Starting"
    );
  });
});
