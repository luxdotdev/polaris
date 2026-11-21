import { describe, expect, test } from "bun:test";
import { proseParts } from "./prose.ts";

const mono = (text: string) =>
  proseParts(text)
    .filter((p) => p.mono)
    .map((p) => p.text);

describe("proseParts", () => {
  test("paths and dotted names are mono; their punctuation and the prose around them aren't", () => {
    const text =
      "Trace in traces/pi-4/run.ndjson. It emits lead.ended then (lead.started), see /tmp and e.g. this.";

    expect(mono(text)).toEqual(["traces/pi-4/run.ndjson", "lead.ended", "lead.started"]);
    expect(
      proseParts(text)
        .map((p) => p.text)
        .join("")
    ).toBe(text);
  });

  test("whitespace is kept as written", () => {
    expect(proseParts("one\n\n  two").map((p) => p.text)).toEqual(["one\n\n  two"]);
  });

  test.each([
    ["a slash-free run", "a".repeat(50_000)],
    ["a run of dots", "a.".repeat(25_000)],
    ["a run of slashes", "a/".repeat(25_000)],
    ["trailing punctuation", `${"x".repeat(25_000)}${",".repeat(25_000)}y`],
  ])("%s of 50k characters splits in linear time", (_, text) => {
    const started = performance.now();
    const parts = proseParts(text);

    expect(performance.now() - started).toBeLessThan(50);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });
});
