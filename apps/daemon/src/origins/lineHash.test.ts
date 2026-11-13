import { expect, test } from "bun:test";
import { lineHash } from "./lineHash.ts";

test("whitespace changes keep a line's hash", () => {
  const hash = lineHash("  const total = items.reduce(add, 0);");

  expect(hash).not.toBeNull();
  expect(lineHash("const total =   items.reduce(add,\t0);  \r")).toBe(hash);
});

test("a changed token changes the hash", () => {
  expect(lineHash("const total = items.reduce(add, 0);")).not.toBe(
    lineHash("const total = items.reduce(add, 1);")
  );
});

test.each([
  ["blank", "   "],
  ["punctuation only", "  });"],
  ["a closing branch", "} else {"],
  ["eleven letters", "return total;"],
  ["ten letters", "return null;"],
])("%s is too common to identify", (_, line) => {
  expect(lineHash(line)).toBeNull();
});

test.each([
  ["twelve letters", "return result;"],
  ["letters outside ASCII", "const größe = maßstab;"],
])("%s identifies a line", (_, line) => {
  expect(lineHash(line)).toMatch(/^[0-9a-f]{32}$/);
});
