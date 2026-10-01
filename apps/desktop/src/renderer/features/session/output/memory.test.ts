import { describe, expect, test } from "bun:test";
import { CLOSED, editOpens, remember, toggled } from "./memory.ts";

describe("output memory", () => {
  test("a first edit opens a session the user never toggled", () => {
    expect(editOpens({}, "a")).toEqual({ a: { open: true, toggled: false } });
  });

  test("the user's choice holds against later edits", () => {
    const closed = toggled(editOpens({}, "a"), "a", false);

    expect(editOpens(closed, "a")).toBe(closed);
    expect(closed.a).toEqual({ open: false, toggled: true });
  });

  test("nothing changes when it's already open", () => {
    const open = editOpens({}, "a");

    expect(editOpens(open, "a")).toBe(open);
  });

  test("the oldest sessions are forgotten past the limit", () => {
    let memories = {};

    for (const key of ["a", "b", "c", "d"]) memories = remember(memories, key, CLOSED, 3);
    memories = remember(memories, "b", { open: true, toggled: true }, 3);
    expect(Object.keys(memories)).toEqual(["c", "d", "b"]);
  });
});
