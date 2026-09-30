import { describe, expect, test } from "bun:test";
import { registerActions, registeredActions } from "./actions.ts";

const action = (id: string, title = id) => ({ id, title, group: "Test", run: () => undefined });

describe("the action registry", () => {
  test("registers, replaces by id and removes", () => {
    const off = registerActions([action("a"), action("b")]);
    const offAgain = registerActions([action("a", "A again")]);

    expect(registeredActions().map((a) => a.title)).toEqual(["b", "A again"]);
    offAgain();
    expect(registeredActions().map((a) => a.id)).toEqual(["b"]);
    off();
    expect(registeredActions()).toEqual([]);
  });
});
