import { SessionState } from "@polaris/protocol";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";

import { SEVERITIES, SEVERITY_MARKS, SeverityBadge } from "./severity-badge";
import { SESSION_STATES, STATE_GLYPHS, STATE_LABELS, StateIcon } from "./state-icon";

afterEach(cleanup);

describe("StateIcon", () => {
  test("covers every Session State the protocol defines", () => {
    expect([...SESSION_STATES].sort()).toEqual([...SessionState.literals].sort());
  });

  test("maps each state to DESIGN.md's glyph", () => {
    expect(STATE_GLYPHS).toEqual({
      starting: "dither-still",
      working: "dither-moving",
      "needs-you": "pixel-hand",
      idle: "dot-solid",
      "in-terminal": "pixel-terminal",
      dormant: "dot-hollow",
      failed: "pixel-failed",
      archived: "pixel-archive",
    });
  });

  test("gives every state its own form, so none is told apart by colour alone", () => {
    expect(new Set(Object.values(STATE_GLYPHS)).size).toBe(SESSION_STATES.length);
  });

  test("renders a labelled glyph with no visible text", () => {
    for (const state of SESSION_STATES) {
      const { getByRole } = render(<StateIcon state={state} harness="claude" />);
      const icon = getByRole("img", { name: STATE_LABELS[state] });

      expect(icon.getAttribute("data-glyph")).toBe(STATE_GLYPHS[state]);
      expect(icon.textContent).toBe("");
      cleanup();
    }
  });

  test("only Working moves", () => {
    for (const state of SESSION_STATES) {
      const { container } = render(<StateIcon state={state} harness="codex" />);
      const moving = container.querySelectorAll("[data-moving]").length;

      expect(moving).toBe(state === "working" ? 1 : 0);
      cleanup();
    }
  });
});

describe("SeverityBadge", () => {
  test("always carries its label and its own mark", () => {
    for (const severity of SEVERITIES) {
      const { container } = render(<SeverityBadge severity={severity} />);
      const badge = container.querySelector("[data-slot=severity-badge]");

      expect(badge?.textContent).toBe(severity[0]?.toUpperCase() + severity.slice(1));
      expect(badge?.querySelector("svg")?.getAttribute("data-mark")).toBe(SEVERITY_MARKS[severity]);
      cleanup();
    }

    expect(new Set(Object.values(SEVERITY_MARKS)).size).toBe(SEVERITIES.length);
  });

  test("keeps the label for screen readers when showing a count", () => {
    const { container } = render(<SeverityBadge severity="high" count={3} />);

    expect(container.textContent).toBe("High3");
  });

  test("dims low confidence, but never a Critical", () => {
    for (const severity of SEVERITIES) {
      const { container } = render(<SeverityBadge severity={severity} lowConfidence />);
      const dimmed = container.querySelector("[data-dimmed]") !== null;

      expect(dimmed).toBe(severity !== "critical");
      cleanup();
    }
  });
});

describe("rule/severity-vs-state", () => {
  test("a Severity and a Session State never share a form", () => {
    const stateForms = new Set<string>(Object.values(STATE_GLYPHS));

    for (const mark of Object.values(SEVERITY_MARKS)) expect(stateForms.has(mark)).toBe(false);
  });

  test("states render as unlabelled glyphs; severities as labelled badges", () => {
    const { container } = render(
      <>
        <StateIcon state="needs-you" harness="claude" />
        <SeverityBadge severity="medium" />
        <StateIcon state="failed" harness="claude" />
        <SeverityBadge severity="critical" />
      </>
    );

    const states = container.querySelectorAll("[data-slot=state-icon]");
    const badges = container.querySelectorAll("[data-slot=severity-badge]");

    for (const state of states) {
      expect(state.getAttribute("role")).toBe("img");
      expect(state.textContent).toBe("");
      expect(state.getAttribute("data-slot")).not.toBe("severity-badge");
    }

    for (const badge of badges) {
      expect(badge.textContent?.length).toBeGreaterThan(0);
      expect(badge.querySelector("[data-slot=state-icon]")).toBeNull();
    }
  });
});
