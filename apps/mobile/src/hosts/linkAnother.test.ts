import { expect, test } from "bun:test";
import { CLOSED, closed, opened } from "./linkAnother.ts";

test("each opening of Link another Mac mounts a fresh sheet, so a used one never comes back", () => {
  const first = opened(CLOSED);
  const second = opened(closed(first));

  expect(first.open && second.open).toBe(true);
  expect(second.round).not.toBe(first.round);
});

test("opening an open sheet again keeps it, so a link under way isn't thrown away", () => {
  const open = opened(CLOSED);

  expect(opened(open)).toEqual(open);
});
