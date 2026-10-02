import { describe, expect, test } from "bun:test";
import { sourceBlock, targetOrder, withSource } from "./source.ts";

describe("sourceBlock", () => {
  test("path, range and a fenced copy", () => {
    expect(
      sourceBlock({ path: "src/hosts/reconnect.ts", first: 10, last: 12, text: "a\nb\nc" })
    ).toBe("`src/hosts/reconnect.ts` lines 10–12:\n```ts\na\nb\nc\n```\n");
  });

  test("a longer fence when the text has backticks", () => {
    expect(sourceBlock({ path: "README", first: 1, last: 1, text: "```js" })).toBe(
      "`README` line 1:\n````\n```js\n````\n"
    );
  });
});

describe("withSource", () => {
  test("appends after a blank line, or stands alone", () => {
    expect(withSource("", "B")).toBe("B");
    expect(withSource("look at this  \n", "B")).toBe("look at this\n\nB");
  });
});

describe("targetOrder", () => {
  const sessions = [
    { id: "a", updatedAt: "2026-10-01T00:00:00Z" },
    { id: "b", updatedAt: "2026-10-02T00:00:00Z" },
    { id: "c", updatedAt: "2026-09-30T00:00:00Z" },
  ];

  test("the last focused first, then the most recent", () => {
    expect(targetOrder(sessions, "c").map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(targetOrder(sessions, null).map((s) => s.id)).toEqual(["b", "a", "c"]);
  });
});
