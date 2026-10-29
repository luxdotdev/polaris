import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import type { Finding } from "../model/summary.ts";
import { updateSurface } from "../../review/index.ts";
import { CriticalPause } from "./CriticalPause.tsx";

const finding = (id: string, patch: Partial<Finding> = {}): Finding =>
  // SAFETY: test fixture; the branded ids are plain strings at runtime.
  ({
    id,
    identity: `identity-${id}`,
    source: "rule",
    ruleId: null,
    suggestion: null,
    resolution: null,
    path: "server/eligibility/check.ts",
    lines: { start: 18, end: 18, side: "new" },
    severity: "critical",
    confidence: 0.97,
    title: "Income limit read from the request",
    reason: "",
    status: "open",
    ...patch,
  }) as Finding;

const show = (key: string) =>
  render(
    <CriticalPause subjectKey={key} onClose={() => undefined}>
      <div data-testid="review-form" />
    </CriticalPause>
  );

afterEach(cleanup);

describe("Submit review with a critical finding open", () => {
  test("pauses once, naming the finding, then goes on to the review", () => {
    updateSurface("pause:a", { findings: [finding("c1"), finding("h1", { severity: "high" })] });
    const view = show("pause:a");

    expect(view.queryByTestId("review-form")).toBeNull();
    expect(view.getByTestId("critical-pause").textContent).toContain("1 critical finding is open");
    expect(view.getAllByTestId("critical-pause-finding").map((n) => n.textContent)).toEqual([
      "CriticalIncome limit read from the requestcheck.ts:18",
    ]);

    fireEvent.click(view.getByTestId("critical-pause-submit"));
    expect(view.getByTestId("review-form")).not.toBeNull();

    // Opened again with the same critical open: it doesn't ask twice.
    cleanup();
    expect(show("pause:a").getByTestId("review-form")).not.toBeNull();
  });

  test("a new critical asks again; none, dismissed or resolved never pauses", () => {
    updateSurface("pause:b", { findings: [finding("c1")] });
    fireEvent.click(show("pause:b").getByTestId("critical-pause-submit"));
    cleanup();

    updateSurface("pause:b", { findings: [finding("c1"), finding("c2")] });
    expect(show("pause:b").getByTestId("critical-pause").textContent).toContain(
      "2 critical findings are open"
    );
    cleanup();

    updateSurface("pause:c", {
      findings: [
        finding("c1", { status: "dismissed" }),
        finding("c2", { status: "resolved" }),
        finding("h1", { severity: "high" }),
      ],
    });
    expect(show("pause:c").getByTestId("review-form")).not.toBeNull();
  });
});
