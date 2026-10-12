import { describe, expect, test } from "bun:test";
import { leadModel } from "../preview/sessions.ts";
import { digestFold } from "./digest.ts";

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
