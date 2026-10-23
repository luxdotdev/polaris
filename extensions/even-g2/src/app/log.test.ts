/** The phone shows the connection log newest first, and only the latest lines. */
import { expect, test } from "bun:test";
import { connectionLog } from "./log.ts";

test("the newest line comes first, and the oldest fall off past the limit", () => {
  const log = connectionLog(3, () => new Date(2026, 9, 23, 18, 34, 23, 7));

  for (const line of ["opening", "opened", "message 1", "message 2"]) log.add(line);

  expect(log.lines()).toEqual([
    "18:34:23.007 message 2",
    "18:34:23.007 message 1",
    "18:34:23.007 opened",
  ]);
});
