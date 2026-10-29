import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { type Bucket, usageSummary } from "../model/usage.ts";
import { TokensCard } from "./UsageTokens.tsx";

const NOW = Date.parse("2026-09-30T15:00:00Z");

const bucket = (hour: string, model: string, n: number): Bucket => ({
  hour,
  harness: "claude",
  model,
  sessionId: null,
  tokens: { input: n, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cacheWrite1h: 0 },
  reportedCost: null,
  longContext: [],
});

/** Sep 29 ran Opus alone; today ran Sonnet and more Opus. */
const summary = usageSummary({
  days: 7,
  now: NOW,
  buckets: [
    bucket("2026-09-29T12:00:00Z", "opus-5", 4_000),
    bucket("2026-09-30T09:00:00Z", "opus-5", 1_000),
    bucket("2026-09-30T10:00:00Z", "sonnet-5", 2_000),
  ],
});

const card = () =>
  render(
    <TokensCard
      summary={summary}
      now={NOW}
      hostCount={1}
      indexing={false}
      days={7}
      onDays={() => undefined}
    />
  );

/** Each table row as "model tokens". */
const tableRows = (view: ReturnType<typeof card>) =>
  view.getAllByTestId("usage-model-row").map((row) => {
    const [model, , tokens] = [...row.children].map((c) => c.textContent);

    return `${model} ${tokens}`;
  });

const bar = (view: ReturnType<typeof card>, date: string) =>
  view.getAllByTestId("usage-bar").find((b) => b.dataset.date === date)!;

afterEach(cleanup);

describe("pinning a day", () => {
  test("a clicked day narrows the table to its rows, named over the table", () => {
    const view = card();

    expect(tableRows(view)).toEqual(["opus-5 5K", "sonnet-5 2K"]);
    fireEvent.click(bar(view, "2026-09-29"));

    expect(tableRows(view)).toEqual(["opus-5 4K"]);
    expect(bar(view, "2026-09-29").dataset.pinned).toBe("true");
    expect(view.getByTestId("usage-pinned").textContent).toBe("Sep 29·Show all");
  });

  test.each([
    ["Show all", (view: ReturnType<typeof card>) => fireEvent.click(view.getByText("Show all"))],
    ["a second click", (view: ReturnType<typeof card>) => fireEvent.click(bar(view, "2026-09-29"))],
    [
      "esc",
      (view: ReturnType<typeof card>) =>
        fireEvent.keyDown(view.getByTestId("usage-chart"), { key: "Escape" }),
    ],
  ])("%s restores the whole range", (_, unpin) => {
    const view = card();

    fireEvent.click(bar(view, "2026-09-29"));
    unpin(view);

    expect(tableRows(view)).toEqual(["opus-5 5K", "sonnet-5 2K"]);
    expect(view.queryByTestId("usage-pinned")).toBeNull();
    expect(bar(view, "2026-09-29").dataset.pinned).toBeUndefined();
  });

  test("↵ on the focused day pins it, and the hover tooltip still shows", async () => {
    const view = card();
    const chart = view.getByTestId("usage-chart");

    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "Enter" });
    await act(() => Bun.sleep(1));

    expect(tableRows(view)).toEqual(["sonnet-5 2K", "opus-5 1K"]);
    expect(within(view.getByTestId("usage-pinned")).getByText("Today")).toBeTruthy();
    expect(view.getByTestId("usage-tooltip").textContent).toContain("Total");
  });
});
