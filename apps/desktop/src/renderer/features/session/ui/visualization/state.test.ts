import { describe, expect, test } from "bun:test";
import { STATE_MAX_BYTES, STATES_MAX_BYTES, stateStore } from "./state.ts";

const memory = () => {
  const items = new Map<string, string>();

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe("pv.state on this device", () => {
  test("is kept per Visualization and survives a new store over the same storage", () => {
    const storage = memory();

    stateStore(storage).save("viz_a", '{"pv":1,"value":3}');
    stateStore(storage).save("viz_b", '{"pv":1,"value":4}');

    expect(stateStore(storage).load("viz_a")).toBe('{"pv":1,"value":3}');
    expect(stateStore(storage).load("viz_b")).toBe('{"pv":1,"value":4}');
  });

  test("one too large to keep is refused, and the last state stays", () => {
    const store = stateStore(memory());

    store.save("viz_a", '"small"');

    expect(store.save("viz_a", JSON.stringify("x".repeat(STATE_MAX_BYTES)))).toBe(false);
    expect(store.load("viz_a")).toBe('"small"');
  });

  test("past the total cap, the least recently saved go first", () => {
    const store = stateStore(memory());
    const big = JSON.stringify("x".repeat(STATE_MAX_BYTES - 100));
    const count = Math.ceil(STATES_MAX_BYTES / STATE_MAX_BYTES) + 2;

    for (let n = 0; n < count; n++) store.save(`viz_${n}`, big);

    expect(store.load("viz_0")).toBeUndefined();
    expect(store.load(`viz_${count - 1}`)).toBe(big);
  });

  test("storage that throws or holds garbage costs only the state", () => {
    const broken = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    const store = stateStore(broken);

    expect(store.save("viz_a", "1")).toBe(true);
    expect(store.load("viz_a")).toBeUndefined();
  });
});
