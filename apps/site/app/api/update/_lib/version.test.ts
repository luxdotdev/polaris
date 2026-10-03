import { expect, test } from "bun:test";
import { compareVersions, parseVersion } from "./version.ts";

test.each([
  "",
  "1",
  "1.2",
  "v1.2.3",
  "01.2.3",
  "1.02.3",
  "1.2.03",
  "1.2.3-01",
  "1.2.3-rc..1",
  "1.2.3+",
  "1.2.3\n",
  "1.2.3/evil",
  "x".repeat(129),
])("rejects malformed version %j", (value) => {
  expect(parseVersion(value)).toBeNull();
});

test.each([
  ["1.2.3", "1.2.3", 0],
  ["1.2.3+first", "1.2.3+second", 0],
  ["1.2.9", "1.2.10", -1],
  ["1.10.0", "1.9.0", 1],
  ["2.0.0", "1.99.99", 1],
  ["1.2.3-rc.2", "1.2.3-rc.10", -1],
  ["1.2.3-rc.1", "1.2.3", -1],
  ["1.2.3", "1.2.3-rc.1", 1],
  ["1.2.3-alpha", "1.2.3-alpha.1", -1],
  ["1.2.3-1", "1.2.3-alpha", -1],
  ["1.2.3-beta", "1.2.3-alpha", 1],
  ["9007199254740992.0.0", "9007199254740993.0.0", -1],
])("compares %s to %s", (left, right, expected) => {
  expect(compareVersions(parseVersion(left)!, parseVersion(right)!)).toBe(expected);
});
