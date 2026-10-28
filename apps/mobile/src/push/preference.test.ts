import { describe, expect, test } from "bun:test";
import { createPreference } from "./preference.ts";

const storage = (stored: string | null) => {
  const saved: Array<string> = [];

  let resolve: (value: string | null) => void = () => {};

  const load = new Promise<string | null>((r) => (resolve = r));

  return {
    saved,
    loaded: async () => {
      resolve(stored);
      await load;
      await Promise.resolve();
    },
    storage: { load: () => load, save: async (value: string) => void saved.push(value) },
  };
};

describe("this device's constellation switch", () => {
  test("is on until the stored value says off", async () => {
    const s = storage("off");
    const preference = createPreference(s.storage);

    expect(preference.get()).toBe(true);
    await s.loaded();
    expect(preference.get()).toBe(false);
  });

  test("a change before the load finishes wins, and is saved", async () => {
    const s = storage("off");
    const preference = createPreference(s.storage);
    let changes = 0;
    preference.subscribe(() => changes++);

    preference.set(false);
    preference.set(true);
    await s.loaded();

    expect(preference.get()).toBe(true);
    expect(s.saved).toEqual(["off", "on"]);
    expect(changes).toBe(2);
  });
});
