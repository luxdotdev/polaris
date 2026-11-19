import { describe, expect, test } from "bun:test";
import { CLOSED, editOpens, migrate, remember, toggled } from "./memory.ts";

describe("output memory", () => {
  test("a first edit opens a session the user never toggled", () => {
    expect(editOpens({}, "a")).toEqual({ a: { open: true, toggled: false, opened: true } });
  });

  test("the user's choice holds against later edits", () => {
    const closed = toggled(editOpens({}, "a"), "a", false);

    expect(editOpens(closed, "a")).toBe(closed);
    expect(closed.a).toEqual({ open: false, toggled: true, opened: true });
  });

  test("Output opens itself once per session, never again", () => {
    const once = { a: { open: false, toggled: false, opened: true } };

    expect(editOpens(once, "a")).toBe(once);
  });

  test("stored entries from before keep their toggles and count an open panel as opened", () => {
    expect(
      migrate({
        open: { open: true, toggled: false },
        closed: { open: false, toggled: true },
        fresh: { open: false, toggled: false },
        now: { open: false, toggled: false, opened: true },
      })
    ).toEqual({
      open: { open: true, toggled: false, opened: true },
      closed: { open: false, toggled: true, opened: true },
      fresh: CLOSED,
      now: { open: false, toggled: false, opened: true },
    });
  });

  test("the oldest sessions are forgotten past the limit", () => {
    let memories = {};

    for (const key of ["a", "b", "c", "d"]) memories = remember(memories, key, CLOSED, 3);
    memories = remember(memories, "b", { open: true, toggled: true, opened: true }, 3);
    expect(Object.keys(memories)).toEqual(["c", "d", "b"]);
  });
});
