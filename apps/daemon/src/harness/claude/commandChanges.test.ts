import { expect, test } from "bun:test";
import { CommandChangeJoin } from "./commandChanges.ts";

const changes = { changes: [{ path: "/w/a.ts", kind: "modify" as const }], more: 0 };

test("a completed call waits for its changes through one Turn's end, not through two", () => {
  const join = new CommandChangeJoin<string>();
  join.track("late");
  join.track("lost");
  join.onResult("late", "late call");
  join.onResult("lost", "lost call");
  join.endTurn();

  expect(join.onChanges("late", changes)).toBe("late call");
  join.endTurn();
  expect(join.onChanges("lost", changes)).toBeNull();
});

test("a call the Turn's end found without a result is dropped", () => {
  const join = new CommandChangeJoin<string>();
  join.track("open");
  join.endTurn();

  expect(join.onChanges("open", changes)).toBeNull();
  expect(join.onResult("open", "completed")).toBeUndefined();
});

test("a command that changed nothing doesn't complete again", () => {
  const join = new CommandChangeJoin<string>();
  join.track("call");
  join.onResult("call", "completed");

  expect(join.onChanges("call", { changes: [], more: 0 })).toBeNull();
});

test("changes for a call that was never snapshotted are ignored", () => {
  const join = new CommandChangeJoin<string>();

  expect(join.onChanges("read-only", changes)).toBeNull();
  expect(join.onResult("read-only", "completed")).toBeUndefined();
});
