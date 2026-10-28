import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { applySessionItem, type SessionFold } from "../thread/fold.ts";
import { finding, snapshot, turn } from "../thread/daemon.testing.ts";
import { contextOf } from "./context.ts";

const edit = (id: string, path: string) =>
  TurnItem.cases.FileChange.make({ id, changes: [{ path, kind: "modify" }], status: "completed" });

const read = (id: string) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    title: "Read the notes",
    input: {},
    output: null,
    status: "completed",
  });

const turns =
  [
    snapshot([
      { turn: turn(0), items: [edit("a", "README.md")] },
      {
        turn: turn(1),
        items: [read("b"), edit("c", "index.html"), edit("d", "serve.ts"), edit("e", "CONTEXT.md")],
      },
      { turn: turn(2), items: [] },
    ]),
  ].reduce<SessionFold | null>(applySessionItem, null)?.turns ?? [];

const critical = finding({ path: "serve.ts" });

const high = finding({ id: finding().id, path: "index.html", severity: "high" });

describe("contextOf", () => {
  test("before any tap, it opens the latest Turn's file with an open Critical finding", () => {
    const context = contextOf(turns, [critical, high], null);

    expect(context).toMatchObject({
      turnNumber: 2,
      label: "Edited serve.ts",
      focusKey: "t-1:d",
      path: "serve.ts",
      finding: { title: "Secret-like value committed" },
    });
    expect(context?.also).toEqual([
      { path: "index.html", severity: "high" },
      { path: "CONTEXT.md", severity: null },
    ]);
  });

  test("with no Critical, it opens the last file the latest Turn with files touched", () => {
    expect(contextOf(turns, [], null)).toMatchObject({ path: "CONTEXT.md", turnNumber: 2 });
  });

  test("a tapped step in an earlier Turn wins over the default", () => {
    const tapped = contextOf(turns, [critical], {
      key: "t-0:a",
      turnId: "t-0",
      kind: "step",
      label: "Edited README.md",
      paths: ["README.md"],
    });

    expect(tapped).toMatchObject({ turnNumber: 1, path: "README.md", finding: null, also: [] });
  });

  test("a step that touched no file shows no file, and lists the Turn's files below", () => {
    const tapped = contextOf(turns, [], {
      key: "t-1:b",
      turnId: "t-1",
      kind: "step",
      label: "Read the notes",
      paths: [],
    });

    expect(tapped?.path).toBeNull();
    expect(tapped?.also.map((f) => f.path)).toEqual(["index.html", "serve.ts", "CONTEXT.md"]);
  });

  test("a focus on a Turn no longer loaded falls back to the default", () => {
    const gone = { key: "t-9:x", turnId: "t-9", kind: "step", label: "x", paths: ["x"] } as const;

    expect(contextOf(turns, [], gone)?.path).toBe("CONTEXT.md");
  });

  test("a session with no file steps has no context", () => {
    expect(contextOf(turns.slice(2), [], null)).toBeNull();
  });
});
