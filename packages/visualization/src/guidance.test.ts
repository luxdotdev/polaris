import { describe, expect, test } from "bun:test";
import { VISUALIZE_TOOL_DESCRIPTION, visualizeGuidance } from "./index.ts";

describe("visualize guidance", () => {
  test("rich reaches for visualize whenever structure beats prose; simple only when asked or for a chart or table", () => {
    expect(visualizeGuidance("rich")).toContain(
      "Reach for visualize whenever structure beats prose"
    );
    expect(visualizeGuidance("simple")).toContain(
      "only when asked, or when the answer is a chart or a table"
    );
    expect(visualizeGuidance("simple")).not.toContain("whenever structure beats prose");
  });

  test.each(["rich", "simple"] as const)(
    "%s carries the contract, the layout and the kit",
    (level) => {
      const text = visualizeGuidance(level);

      for (const phrase of [
        "Zero egress",
        "replaces",
        "~728px",
        "~360px",
        "No page background",
        "vh",
        "pv.chart(",
        "pv.bind(",
        "pv.flow(",
        "pv.state.get()",
        "pv.openLink(",
        "ask the agent",
      ]) {
        expect(text).toContain(phrase);
      }
    }
  );

  test("off has no guidance: the tool is removed", () => {
    expect(visualizeGuidance("off")).toBe("");
  });

  test("the tool description stays compact and names the frame's limits", () => {
    expect(VISUALIZE_TOOL_DESCRIPTION.length).toBeLessThan(900);
    expect(VISUALIZE_TOOL_DESCRIPTION).toContain("no network");
    expect(VISUALIZE_TOOL_DESCRIPTION).toContain("replaces");
  });
});
