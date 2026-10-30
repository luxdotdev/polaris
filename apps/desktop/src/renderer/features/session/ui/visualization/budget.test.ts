import { describe, expect, test } from "bun:test";
import { frameBudget } from "./budget.ts";

const live = (budget: ReturnType<typeof frameBudget>, keys: ReadonlyArray<string>) =>
  keys.filter((key) => budget.isLive(key));

describe("the live frame budget", () => {
  test("never more than four frames are live, the most recent first", () => {
    const budget = frameBudget(4);
    const keys = ["a", "b", "c", "d", "e", "f"];

    for (const key of keys) budget.place(key, "near");

    expect(live(budget, keys)).toEqual(["c", "d", "e", "f"]);
  });

  test("frames on screen win over frames only near it", () => {
    const budget = frameBudget(2);

    budget.place("on", "visible");
    budget.place("n1", "near");
    budget.place("n2", "near");

    expect(live(budget, ["on", "n1", "n2"])).toEqual(["on", "n2"]);
  });

  test("away frames are never live, and leaving frees a slot", () => {
    const budget = frameBudget(1);

    budget.place("a", "visible");
    budget.place("b", "away");

    expect(live(budget, ["a", "b"])).toEqual(["a"]);

    budget.place("b", "near");
    budget.remove("a");

    expect(live(budget, ["a", "b"])).toEqual(["b"]);
  });

  test("listeners hear only when the live set changes", () => {
    const budget = frameBudget(1);
    let heard = 0;

    budget.subscribe(() => (heard += 1));
    budget.place("a", "visible");
    budget.place("b", "near");
    budget.place("b", "near");

    expect(heard).toBe(1);
  });
});
