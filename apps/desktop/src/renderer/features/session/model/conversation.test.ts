import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem } from "@polaris/protocol";
import { approval, turnWith } from "../../../store/fixtures.testing.ts";
import type { LiveItem, TurnView } from "../../../store/sessionModel.ts";
import { conversationRows, summarize, turnRows } from "./conversation.ts";
import { completedItemView, liveItemView, outputTail, toolSummary } from "./items.ts";
import { queuedOutgoing } from "./outbox.ts";

const I = TurnItem.cases;

const view = (
  index: number,
  items: ReadonlyArray<TurnItem>,
  live: ReadonlyMap<string, LiveItem> = new Map(),
  status: "working" | "completed" | "interrupted" | "failed" = "completed"
): TurnView => ({
  turn: turnWith({ id: TurnId.make(`t${index}`), index, prompt: `prompt ${index}`, status }),
  items,
  live,
});

const message = (id: string, text: string) => I.AssistantMessage.make({ id, text });

const files = (id: string, paths: ReadonlyArray<string>) =>
  I.FileChange.make({
    id,
    changes: paths.map((path) => ({ path, kind: "modify" as const })),
    status: "completed",
  });

describe("items", () => {
  test("a completed item keeps its view's identity", () => {
    const item = message("m1", "hello");

    expect(completedItemView(item)).toBe(completedItemView(item));
  });

  test("streamed text overrides the progress snapshot", () => {
    const progress = I.CommandExecution.make({
      id: "c1",
      command: "bun test",
      cwd: "/r",
      output: "",
      exitCode: null,
      status: "running",
    });

    expect(liveItemView("c1", { item: progress, text: "", output: "pass 3\n" })).toMatchObject({
      kind: "command",
      command: "bun test",
      output: "pass 3\n",
      live: true,
    });
  });

  test("an item with only output deltas is a running command", () => {
    expect(liveItemView("x", { item: null, text: "", output: "…" }).kind).toBe("command");
    expect(liveItemView("y", { item: null, text: "Hi", output: "" }).kind).toBe("message");
  });

  test("output keeps its tail", () => {
    expect(outputTail("a\nb\nc\nd\n", 2)).toEqual({ text: "c\nd", hidden: 2 });
    expect(outputTail("a\nb", 5)).toEqual({ text: "a\nb", hidden: 0 });
  });

  test("tool input on one line", () => {
    expect(toolSummary({ path: "src/index.ts" })).toBe("src/index.ts");
    expect(toolSummary({ file_path: "a.ts", limit: 20 })).toBe("a.ts");
    expect(toolSummary({ command: "bun test", timeout: 5 })).toBe("bun test");
    expect(toolSummary({ n: 1 })).toBe('{"n":1}');
    expect(toolSummary("x".repeat(300)).length).toBe(160);
    expect(toolSummary(null)).toBe("");
  });
});

describe("conversation rows", () => {
  const earlier = view(0, [message("m0", "Recorded the decision\nmore"), files("f0", ["a", "b"])]);
  const last = view(1, [message("m1", "done")], new Map(), "working");

  test("earlier Turns fold to one summary; the last stays open", () => {
    const rows = conversationRows({ turns: [earlier, last], approvals: [], unfolded: new Set() });

    expect(rows.map((r) => r.kind)).toEqual(["summary", "prompt", "item"]);
    expect(rows[0]).toMatchObject({ number: 1, summary: "Recorded the decision", files: 2 });
  });

  test("an unfolded Turn expands", () => {
    const rows = conversationRows({
      turns: [earlier, last],
      approvals: [],
      unfolded: new Set(["t0"]),
    });

    expect(rows.map((r) => r.kind)).toEqual(["prompt", "item", "item", "prompt", "item"]);
    expect(rows.filter((r) => r.kind === "item").map((r) => r.lead)).toEqual([true, false, true]);
  });

  test("a summary falls back to the prompt", () => {
    expect(summarize(view(2, [])).summary).toBe("prompt 2");
  });

  test("live items follow completed ones", () => {
    const live = new Map([["m2", { item: null, text: "stream", output: "" }]]);
    const rows = turnRows(view(1, [message("m1", "a")], live, "working"), true, true);

    expect(rows.map((r) => (r.kind === "item" ? [r.item.id, r.item.live] : r.kind))).toEqual([
      "prompt",
      ["m1", false],
      ["m2", true],
    ]);
  });

  test("rows are cached per Turn view and fold state", () => {
    const v = view(0, [message("m0", "x")]);

    expect(turnRows(v, true, false)).toBe(turnRows(v, true, false));
    expect(turnRows(v, false, false)).not.toBe(turnRows(v, true, false));
  });

  test("approvals follow the Turn that asked", () => {
    const asking = view(0, [], new Map(), "working");
    const rows = conversationRows({ turns: [asking], approvals: [approval], unfolded: new Set() });

    expect(rows.map((r) => r.kind)).toEqual(["prompt", "approval"]);
  });

  test("an approval for a Turn not loaded closes the list", () => {
    const rows = conversationRows({ turns: [], approvals: [approval], unfolded: new Set() });

    expect(rows.map((r) => r.kind)).toEqual(["approval"]);
  });

  test("an interrupted last Turn offers Continue; an earlier one doesn't", () => {
    const interrupted = view(0, [], new Map(), "interrupted");
    const rows = turnRows(interrupted, true, true);

    expect(rows.at(-1)).toMatchObject({ kind: "ending", canContinue: true });
    expect(turnRows(view(0, [], new Map(), "interrupted"), true, false).at(-1)).toMatchObject({
      kind: "ending",
      canContinue: false,
    });
    expect(turnRows(view(0, [], new Map(), "completed"), true, true).at(-1)?.kind).toBe("prompt");
  });

  test("a failed last Turn offers Retry; an earlier one doesn't", () => {
    expect(turnRows(view(0, [], new Map(), "failed"), true, true).at(-1)).toMatchObject({
      kind: "ending",
      canContinue: false,
      canRetry: true,
    });
    expect(turnRows(view(0, [], new Map(), "failed"), true, false).at(-1)).toMatchObject({
      canRetry: false,
    });
  });
});

describe("steers in the conversation", () => {
  test("a landed steer is its own row; the next agent item carries the avatar again", () => {
    const rows = turnRows(
      view(0, [
        message("m1", "a"),
        I.UserMessage.make({ id: "u1", text: "b" }),
        message("m2", "c"),
      ]),
      true,
      true
    ).filter((r) => r.kind === "item");

    expect(rows.map((r) => [r.item.kind, r.lead])).toEqual([
      ["message", true],
      ["user", false],
      ["message", true],
    ]);
  });

  test("outgoing messages close the list", () => {
    const entry = queuedOutgoing("next", []);
    const outbox = [entry];

    const rows = conversationRows({
      turns: [view(0, [])],
      approvals: [],
      unfolded: new Set(),
      outbox,
    });

    expect(rows.at(-1)).toMatchObject({ kind: "outgoing", key: `outgoing:${entry.id}`, entry });
  });
});
