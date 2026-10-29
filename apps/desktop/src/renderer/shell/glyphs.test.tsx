import "../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { SessionState } from "@polaris/protocol";
import { leadStar } from "@polaris/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionTile, SummaryGlyph } from "./glyphs.tsx";

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

const tile = (state: SessionState, lead = false) =>
  renderToStaticMarkup(
    <SessionTile state={state} harness="claude" density="balanced" celestial="banded" lead={lead} />
  );

describe("a session row's Celestial", () => {
  test("shows the session's own planet, or its star while it leads", () => {
    expect(tile("idle")).toContain('data-body="banded"');
    expect(tile("idle", true)).toContain(`data-body="${leadStar("banded")}"`);
  });

  test("moves only while Working, and dims only when Dormant or Archived", () => {
    const states: ReadonlyArray<SessionState> = [
      "starting",
      "working",
      "needs-you",
      "idle",
      "dormant",
      "failed",
      "archived",
    ];

    const moving = states.filter((s) => tile(s).includes("polaris-celestial-live"));
    const dimmed = states.filter((s) => tile(s).includes("data-dormant"));

    expect(moving).toEqual(["working"]);
    expect(dimmed).toEqual(["dormant", "archived"]);
  });
});
