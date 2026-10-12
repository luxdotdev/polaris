import { describe, expect, test } from "bun:test";
import { leadModel } from "../preview/sessions.ts";
import { digestFold, digestStarted } from "./digest.ts";

describe("digestFold", () => {
  const [earlier, digest] = leadModel().turns;

  test("a folded digest Turn keeps its number and the Lead's reply", () => {
    if (digest === undefined) throw new Error("fixture has two Turns");
    const fold = digestFold(digest);

    expect(fold.number).toBe(14);
    expect(fold.reply).toStartWith("B1's trace check fails on the handover log");
  });

  test("before the Lead replies there is no reply line", () => {
    if (earlier === undefined) throw new Error("fixture has two Turns");

    expect(digestFold({ ...earlier, items: [] }).reply).toBeNull();
  });
});

describe("digestStarted", () => {
  const base = { leadSessionId: "lead", revision: 1, at: "2026-10-11T12:00:00Z", items: [] };

  test("a digest Turn is Polaris's unless the digest was steered into it", () => {
    // SAFETY: plain test values; the branded ids compare as strings.
    const digests = [
      { ...base, turnId: "t-new" },
      { ...base, turnId: "t-user", steered: true },
      { ...base, turnId: "t-old", steered: false },
    ] as never;

    expect(digestStarted(digests, "t-new")).toBe(true);
    expect(digestStarted(digests, "t-old")).toBe(true);
    expect(digestStarted(digests, "t-user")).toBe(false);
    expect(digestStarted(digests, "t-other")).toBe(false);
  });
});
