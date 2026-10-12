import "../../../test/dom.testing.ts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { DividerRow } from "../model/layout.ts";
import { FileHeader, type HeaderModel, headerStore } from "./FileHeader.tsx";

const turn: DividerRow = {
  turn: 24,
  harness: "claude",
  quote: "Publish the build",
  label: "Turn 24",
  sectionIds: ["24"],
  caption: "1 file",
  folded: true,
  reviewed: false,
};

const show = (divider: DividerRow) => {
  const row: HeaderModel = {
    path: "serve.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    collapsed: false,
    viewed: false,
    changed: false,
    severity: null,
    divider,
    note: null,
  };

  headerStore.setState({ rows: { a: row }, actions: null });

  return render(<FileHeader id="a" />).getByTestId("turn-divider");
};

afterEach(cleanup);

describe("a section divider", () => {
  test("a Turn shows its Harness tile and quotes its prompt", () => {
    const divider = show(turn);

    expect(divider.querySelector("[data-category]")).toBeNull();
    expect(divider.textContent).toContain("“Publish the build”");
    expect(divider.textContent).not.toContain("Critical");
  });

  test("an Intent Group shows its glyph, the Critical badge and its why unquoted", () => {
    const divider = show({
      ...turn,
      label: "Publish",
      quote: "Ships the build to the CDN.",
      intent: { label: "Publish", category: "security", critical: true, turns: [24] },
    });

    expect(divider.querySelector("[data-category]")?.getAttribute("data-category")).toBe(
      "security"
    );
    expect(divider.textContent).toContain("Critical");
    expect(divider.textContent).toContain("Ships the build to the CDN.");
    expect(divider.textContent).not.toContain("“");
  });

  test("an Intent Group that isn't critical has no badge", () => {
    const divider = show({
      ...turn,
      intent: { label: "Docs", category: "docs", critical: false, turns: [24] },
    });

    expect(divider.textContent).not.toContain("Critical");
  });
});
