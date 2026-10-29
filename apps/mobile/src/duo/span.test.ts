import { describe, expect, test } from "bun:test";
import { B3_SUMMARY, paperSpan } from "./paperSpan.testing.ts";
import { chartRows, claimPane, firstChosen, spanChart, spanSummary } from "./span.ts";

const NOW = Date.parse("2026-10-29T13:12:00Z");

const source = paperSpan(NOW);

const rows = chartRows(source.constellation, source.projections, NOW);

const chart = spanChart(source.constellation, rows);

const taskRows = rows.map((r) => r.row);

describe("the span's chart (MX-AG)", () => {
  test("bands are the groups in first-seen order, lettered A, B, C…", () => {
    expect(chart.bands.map((b) => [b.letter, b.name])).toEqual([
      ["A", "settings"],
      ["B", "hosts"],
      ["C", "review"],
      ["D", "duo"],
    ]);
  });

  test("each task's wave is its dependency depth plus one, its label its place in the band", () => {
    const at = new Map(chart.tasks.map((t) => [t.id, [t.label, t.wave, t.state, t.dependsOn]]));

    expect(at.get("B3")).toEqual(["B3", 3, "review", ["B2"]]);
    expect(at.get("C2")).toEqual(["C1", 1, "done", []]);
    expect(at.get("C3")).toEqual(["C2", 3, "review", ["B2"]]);
    expect(at.get("A4")).toEqual(["A4", 4, "waiting", ["A3", "B3"]]);
    expect(at.get("D3")).toEqual(["D1", 2, "working", ["C2"]]);
  });

  test("the headline counts done and the rest, leaving out the zeros", () => {
    expect(spanSummary(taskRows)).toEqual({
      done: "5 of 12 done",
      line: "2 working · 2 claims to review · 3 waiting",
    });
  });
});

describe("the claim pane", () => {
  test("opens on the first claim handed to you", () => {
    expect(firstChosen(taskRows)).toBe("B3");
  });

  test("shows the claim with its attempt, checks and head, and the other claim waiting", () => {
    const pane = claimPane(source.constellation, source.projections, taskRows, chart, "B3", NOW);

    expect(pane).toEqual({
      kicker: "Task B3 · wave 3",
      pill: { text: "Claim ready", tone: "needs-you" },
      title: "Hosts as instrument rows in Settings",
      meta: "attempt 2 · Codex · 18m",
      claim: {
        summary: B3_SUMMARY,
        checks: [
          { label: "bun run typecheck", result: "passed" },
          { label: "bun test apps/mobile", result: "passed" },
          { label: "bun run lint", result: "passed" },
        ],
        head: "head 4c19e2a · 4 commits",
      },
      others: [{ id: "C3", label: "C2" }],
    });
  });

  test("names a task by the label the phone's sheets use, not its wave", () => {
    const pane = claimPane(source.constellation, source.projections, taskRows, chart, "C3", NOW);

    expect(pane?.kicker).toBe("Task C2 · wave 3");
  });

  test("shows the handed claim a verdict answers, not a later-listed attempt's", () => {
    const lostLast = paperSpan(NOW, true);

    const pane = claimPane(
      lostLast.constellation,
      lostLast.projections,
      taskRows,
      chart,
      "B3",
      NOW
    );

    expect(pane?.claim?.summary).toBe(B3_SUMMARY);
    expect(pane?.meta).toBe("attempt 2 · Codex · 18m");
  });

  test("a working task has no claim yet and reads as working", () => {
    const pane = claimPane(source.constellation, source.projections, taskRows, chart, "A3", NOW);

    expect(pane?.claim).toBeNull();
    expect(pane?.pill).toEqual({ text: "Working", tone: "quiet" });
  });

  test("a task the chart doesn't show opens nothing", () => {
    expect(
      claimPane(source.constellation, source.projections, taskRows, chart, "Z9", NOW)
    ).toBeNull();
  });
});
