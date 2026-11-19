import { expect, test } from "bun:test";
import { CommandChangeJoin } from "./commandChanges.ts";

const changes = { changes: [{ path: "/w/a.ts", kind: "modify" as const }], more: 0 };

test("changes read after the Turn ended are dropped with the Turn", () => {
  const join = new CommandChangeJoin<string>();
  join.track("call");

  expect(join.onResult("call", "completed")).toBeUndefined();
  join.clear();
  expect(join.onChanges("call", changes)).toBeNull();
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
