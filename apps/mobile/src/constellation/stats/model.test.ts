import { expect, test } from "bun:test";
import {
  attempt,
  claim,
  constellation,
  mxAbConstellation,
  projection,
  stats,
  task,
  usage,
} from "./fixtures.testing.ts";
import { completionView, duration, reportedPrice, statsSheetView, tokenCount } from "./model.ts";

const sheet = (s = stats(), waitingForYou = 1) =>
  statsSheetView({
    stats: s,
    constellation: mxAbConstellation,
    price: reportedPrice,
    waitingForYou,
  });

test("the stats sheet reads as MX-AB: cost, its split by role, and the counted tasks", () => {
  const view = sheet();

  expect(view.headline).toBe("$4.82");
  // Parents and canceled tasks aren't counted: 8 tasks, 2 children and a gate.
  expect(view.subline).toBe("11 tasks · 1h 12m since the plan · 2.4M tokens");
  expect(view.roles.map((r) => r.label)).toEqual(["Lead $1.10", "Workers $3.72"]);
  expect(view.roles[0]?.share).toBeCloseTo(1.1 / 4.82);
});

test("review says how many claims were accepted first try, then the sent back and waiting", () => {
  const { review } = sheet();

  expect(review.line).toBe("4 of 5 claims accepted first try");
  expect(review.cells).toEqual([
    "accepted",
    "accepted",
    "accepted",
    "accepted",
    "sent-back",
    "waiting",
  ]);
  expect(review.caption).toBe("1 sent back · 1 waiting for you");
});

test("review before any claim is decided says so, with no caption", () => {
  const { review } = sheet(stats({ review: { accepted: 0, reviewed: 0 } }), 0);

  expect(review.line).toBe("No claims reviewed yet");
  expect(review.cells).toEqual([]);
  expect(review.caption).toBeNull();
});

test("worker time sums a task's attempts, shows the longest three and folds the rest", () => {
  const { workers } = sheet();

  expect(workers.total).toBe("2h 41m");
  expect(workers.rows.map((r) => [r.taskId, r.harness, r.time])).toEqual([
    ["A4", "claude", "31m"],
    ["B3", "codex", "18m"],
    ["C1", "claude", "12m"],
  ]);
  expect(workers.rows[1]?.share).toBeCloseTo(18 / 31);
  // D4 recorded no time and D5 none worked; neither is counted.
  expect(workers.rest).toBe("+ 3 more tasks · 23m");
});

test("a cost a Harness didn't report in full is not shown as money: the sheet counts tokens", () => {
  const view = sheet(stats({ total: usage(2_400_000, 1.1, false) }));

  expect(view.measure).toBe("tokens");
  expect(view.headline).toBe("2.4M");
  expect(view.subline).toBe("11 tasks · 1h 12m since the plan");
  expect(view.roles.map((r) => r.label)).toEqual(["Lead 600k", "Workers 1.8M"]);
});

test("durations and token counts read short", () => {
  expect([0, 59_999, 31 * 60_000, 60 * 60_000, 161 * 60_000].map(duration)).toEqual([
    "0m",
    "0m",
    "31m",
    "1h",
    "2h 41m",
  ]);
  expect([512, 86_400, 2_400_000, 12_000_000].map(tokenCount)).toEqual([
    "512",
    "86k",
    "2.4M",
    "12M",
  ]);
});

test("the completion card counts accepted tasks and names the last accepted gate's head", () => {
  const c = constellation(
    [task("A1"), task("A2"), task("G1", { kind: "gate" }), task("G2", { kind: "gate" })],
    [
      attempt("G1", 1, { state: "accepted", claim: claim("aaaaaaa111", "lucas/early") }),
      attempt("G2", 1, {
        state: "accepted",
        claim: claim("e81d07c999", "lucas/eng-530-mobile-chrome-phase-2"),
      }),
    ],
    "completed"
  );

  const projections = [
    projection("A1", "done"),
    projection("A2", "canceled"),
    projection("G1", "done"),
    projection("G2", "done"),
  ];

  const view = completionView(c, projections, stats(), reportedPrice);

  expect(view.kicker).toBe("Constellation complete");
  expect(view.title).toBe("3 of 4 tasks accepted");
  expect(view.rows).toEqual([
    { label: "Cost", value: "$4.82 · lead $1.10" },
    { label: "Time", value: "1h 12m · 2h 41m of workers" },
    { label: "Review", value: "4 of 5 first try" },
    { label: "Head", value: "e81d07c · lucas/eng-530-mobile-chrome-phase-2" },
  ]);
});

test("without stats the completion card keeps only what the graph knows", () => {
  const c = constellation([task("A1")], [], "archived");
  const view = completionView(c, [projection("A1", "done")], null, reportedPrice);

  expect(view.kicker).toBe("Constellation archived");
  expect(view.title).toBe("1 of 1 task accepted");
  expect(view.rows).toEqual([]);
});
