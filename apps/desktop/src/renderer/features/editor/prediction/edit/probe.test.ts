import { expect, test } from "bun:test";
import { identifiersRemoved, probeTarget } from "./probe.ts";

test("a rename removes its old name; punctuation and one-letter names are not identifiers", () => {
  expect(identifiersRemoved("tierOf(x)", "ramTier(x)")).toEqual(["tierOf"]);
  expect(identifiersRemoved("a + b", "b")).toEqual([]);
  expect(identifiersRemoved("const foo = bar;", "const foo = bar;")).toEqual([]);
});

test("the probe target is the nearest whole-word occurrence outside the window", () => {
  const buffer = "tierOf\nmyTierOf tierOfX\n\ntierOf x\n\n\ntierOf";
  expect(probeTarget(buffer, ["tierOf"], { from: 0, to: 7 }, 3)).toBe(buffer.indexOf("tierOf x"));
  expect(probeTarget(buffer, ["tierOf"], { from: 0, to: buffer.length }, 3)).toBeNull();
  expect(probeTarget(buffer, [], { from: 0, to: 0 }, 0)).toBeNull();
  expect(probeTarget("a.b", ["a.b"], { from: 10, to: 10 }, 0)).toBe(0);
});
