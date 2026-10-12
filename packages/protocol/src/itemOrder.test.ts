import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { inStartOrder, placeItem, TurnItem } from "./domain.ts";

const command = (id: string, startedAt: string | null) =>
  TurnItem.cases.CommandExecution.make({
    id,
    command: id,
    cwd: "/repo",
    output: "",
    exitCode: 0,
    status: "completed",
    startedAt,
  });

const ids = (items: ReadonlyArray<TurnItem>) => items.map((i) => i.id);

describe("placeItem", () => {
  test("a long command that completes last still sits where it started", () => {
    const completed = [
      command("quick-1", "2026-10-11T10:00:02.000Z"),
      command("quick-2", "2026-10-11T10:00:03.000Z"),
      command("sleep", "2026-10-11T10:00:01.000Z"),
    ];

    expect(ids(inStartOrder(completed))).toEqual(["sleep", "quick-1", "quick-2"]);
  });

  test("an unstamped item stays where it completed", () => {
    const placed = placeItem(
      [command("a", "2026-10-11T10:00:01.000Z"), command("b", "2026-10-11T10:00:05.000Z")],
      command("refusal", null)
    );

    expect(ids(placed)).toEqual(["a", "b", "refusal"]);
  });

  test("a stamped item passes unstamped ones only to reach a later stamp", () => {
    const placed = placeItem(
      [command("old", null), command("late", "2026-10-11T10:00:09.000Z")],
      command("early", "2026-10-11T10:00:01.000Z")
    );

    expect(ids(placed)).toEqual(["old", "early", "late"]);
  });

  test("an item completed again keeps its place and takes the new content", () => {
    const first = command("a", "2026-10-11T10:00:01.000Z");
    const again = TurnItem.cases.CommandExecution.make({ ...first, output: "done" });
    const placed = placeItem([first, command("b", "2026-10-11T10:00:02.000Z")], again);

    expect(ids(placed)).toEqual(["a", "b"]);
    expect(placed[0]).toMatchObject({ output: "done" });
  });

  test("logs from before the field keep their completion order", () => {
    const legacy = [command("x", null), command("y", null), command("z", null)];

    expect(ids(inStartOrder(legacy))).toEqual(["x", "y", "z"]);
  });

  test("an item logged before the field decodes with no start", () => {
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(TurnItem))(
      '{"_tag":"AssistantMessage","id":"m","text":"hi"}'
    );

    expect(decoded.startedAt).toBeNull();
  });
});
