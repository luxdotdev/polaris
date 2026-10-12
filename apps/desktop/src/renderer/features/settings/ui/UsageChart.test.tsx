import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { type Bucket, usageSummary } from "../model/usage.ts";
import { UsageChart } from "./UsageChart.tsx";

const NOW = Date.parse("2026-09-30T15:00:00Z");

const bucket = (patch: Partial<Bucket> & Pick<Bucket, "hour">): Bucket => ({
  harness: "claude",
  model: "opus-5",
  sessionId: null,
  tokens: { input: 100, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cacheWrite1h: 0 },
  reportedCost: null,
  longContext: [],
  ...patch,
});

const summary = usageSummary({
  days: 7,
  now: NOW,
  buckets: [
    bucket({ hour: "2026-09-30T09:00:00Z", sessionId: SessionId.make("s1") }),
    bucket({ hour: "2026-09-30T10:00:00Z" }),
  ],
});

const todayTip = (split: boolean) => {
  const view = render(<UsageChart summary={summary} split={split} />);

  fireEvent.focus(view.getByTestId("usage-chart"));

  return view.getByTestId("usage-tooltip");
};

afterEach(cleanup);

describe("UsageChart tooltip", () => {
  test("split: usage outside Polaris is dimmed under an in-Polaris subtotal", () => {
    const tip = todayTip(true);
    const dimmed = tip.querySelectorAll<HTMLElement>("[data-outside]");

    expect(dimmed).toHaveLength(1);
    expect(within(dimmed[0]!).getByText("opus-5").className).toContain("text-text-subtle");
    expect(within(tip).getByText("In Polaris sessions")).toBeTruthy();
  });

  test("unsplit: one row per Model and no subtotal", () => {
    const tip = todayTip(false);

    expect(tip.querySelectorAll("[data-outside]")).toHaveLength(0);
    expect(within(tip).queryByText("In Polaris sessions")).toBeNull();
    expect(within(tip).getAllByText("opus-5")).toHaveLength(1);
  });
});
