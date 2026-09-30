import { describe, expect, test } from "bun:test";
import { softBreaks } from "./softWrap.tsx";

describe("softBreaks", () => {
  test("leaves prose and short tokens whole", () => {
    const prose = `${"word ".repeat(400)}${"x".repeat(64)}`;

    expect(softBreaks(prose)).toEqual([prose]);
  });

  test("cuts a long unbroken run every 64 characters, keeping the text", () => {
    const run = "a".repeat(200);
    const pieces = softBreaks(`before ${run} after`);

    expect(pieces.join("")).toBe(`before ${run} after`);
    expect(pieces.length).toBe(4);
    expect(pieces[1]).toBe("a".repeat(64));
  });

  test("never cuts a surrogate pair in half", () => {
    const run = `${"b".repeat(63)}😀${"c".repeat(80)}`;
    const pieces = softBreaks(run);

    expect(pieces.join("")).toBe(run);
    expect(pieces[0]).toBe("b".repeat(63));
    expect(pieces[1]?.startsWith("😀")).toBe(true);
  });
});
