import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { type Bucket, usageSummary } from "../model/usage.ts";
import { UsageChart } from "./UsageChart.tsx";

const NOW = Date.parse("2026-09-30T15:00:00Z");

const input = (n: number) => ({
  input: n,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  cacheWrite1h: 0,
});

const bucket = (patch: Partial<Bucket> & Pick<Bucket, "hour">): Bucket => ({
  harness: "claude",
  model: "opus-5",
  sessionId: null,
  tokens: input(100),
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

/** Focus the chart and let the tooltip's layer place itself. */
const focusTip = async (view: ReturnType<typeof render>) => {
  fireEvent.focus(view.getByTestId("usage-chart"));
  await act(() => Bun.sleep(1));

  return view.getByTestId("usage-tooltip");
};

const todayTip = (split: boolean) =>
  focusTip(render(<UsageChart summary={summary} split={split} />));

afterEach(cleanup);

describe("UsageChart tooltip", () => {
  test("split: usage outside Polaris is dimmed under an in-Polaris subtotal", async () => {
    const tip = await todayTip(true);
    const dimmed = tip.querySelectorAll<HTMLElement>("[data-outside]");

    expect(dimmed).toHaveLength(1);
    expect(within(dimmed[0]!).getByText("opus-5").className).toContain("text-text-subtle");
    expect(within(tip).getByText("In Polaris sessions")).toBeTruthy();
  });

  test("unsplit: one row per Model and no subtotal", async () => {
    const tip = await todayTip(false);

    expect(tip.querySelectorAll("[data-outside]")).toHaveLength(0);
    expect(within(tip).queryByText("In Polaris sessions")).toBeNull();
    expect(within(tip).getAllByText("opus-5")).toHaveLength(1);
  });
});

/** The day of ENG-527's report: nine Models, the two smallest last, 1.7B in all. */
const NINE: ReadonlyArray<readonly [string, string, number]> = [
  ["claude", "claude-opus-5-5", 1_176_760_913],
  ["codex", "gpt-daybreak-blue-latest", 355_036_716],
  ["codex", "gpt-6.1-sol-fast", 113_138_286],
  ["codex", "gpt-6.1-sol", 18_325_078],
  ["codex", "codex-auto-review-fast", 5_465_996],
  ["codex", "codex-auto-review", 2_063_790],
  ["claude", "claude-opus-5", 1_832_157],
  ["claude", "claude-sonnet-5-5", 691_673],
  ["claude", "claude-haiku-5-5", 55_172],
];

describe("UsageChart tooltip placement", () => {
  test("a long day's tooltip is in its own layer, outside the card, every Model above its Total", async () => {
    const busy = usageSummary({
      days: 7,
      now: NOW,
      buckets: NINE.map(([harness, model, n]) =>
        bucket({ hour: "2026-09-30T09:00:00Z", harness, model, tokens: input(n) })
      ),
    });

    const view = render(
      <div data-testid="card" className="overflow-hidden">
        <UsageChart summary={busy} split={false} />
      </div>
    );

    const tip = await focusTip(view);

    // Inside the card, its overflow clipped the first seven rows away (ENG-527).
    expect(view.getByTestId("card").contains(tip)).toBe(false);
    // Today is the right edge: the tooltip opens to its left, over bars, not up over the figures.
    expect(tip.dataset.side).toBe("left");
    expect([...tip.querySelectorAll("span.truncate")].map((r) => r.textContent)).toEqual(
      NINE.map(([, model]) => model)
    );
    expect(within(tip).getByText("Total").parentElement?.textContent).toContain("1.7B");
  });
});
