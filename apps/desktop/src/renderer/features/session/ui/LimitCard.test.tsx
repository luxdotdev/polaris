import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, describe, expect, jest, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LimitCard, limitBody } from "./LimitCard.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const RESETS_AT = new Date(2026, 9, 12, 14, 0).toISOString();

describe("LimitCard", () => {
  test("says when Polaris will continue only while Resume at reset is on", () => {
    expect(limitBody("Claude Code", { resetsAt: RESETS_AT, resumeAtReset: false })).toBe(
      "Claude Code stopped at your plan's limit. Continue picks this Turn up where it stopped."
    );
    expect(limitBody("Claude Code", { resetsAt: RESETS_AT, resumeAtReset: true })).toStartWith(
      "Polaris continues this Turn at 14:00."
    );
    expect(limitBody("Codex", { resetsAt: null, resumeAtReset: true })).toContain(
      "didn't say when it resets"
    );
  });

  test("offers Continue and a switch that is off by default", () => {
    const onContinue = jest.fn();
    const onSetResumeAtReset = jest.fn();

    const { getByRole, getByText } = render(
      <LimitCard
        harness="claude"
        number={24}
        limit={{ resetsAt: RESETS_AT, resumeAtReset: false, onSetResumeAtReset }}
        onContinue={onContinue}
      />
    );

    expect(getByText("Usage limit · resets 14:00")).toBeDefined();
    expect(getByText("turn 24 interrupted")).toBeDefined();
    const toggle = getByRole("switch", { name: "Resume at reset" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onSetResumeAtReset).toHaveBeenCalledWith(true);
    fireEvent.click(getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
