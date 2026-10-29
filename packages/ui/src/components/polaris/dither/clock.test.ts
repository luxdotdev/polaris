import { describe, expect, test } from "bun:test";

import { LiveClock } from "./clock";
import { LIVE_FRAME_MS } from "./glow";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the live field's clock", () => {
  test("steps at 12 fps while a Turn runs, and stops back at the still corner", async () => {
    const steps: number[] = [];
    const clock = new LiveClock((step) => steps.push(step));

    clock.set({ active: true });
    await wait(LIVE_FRAME_MS * 4.5);
    clock.set({ active: false });

    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(steps.at(-1)).toBe(0);
    clock.dispose();
  });

  test.each([
    ["no Turn runs", { active: false }],
    ["it is scrolled out of view", { active: true, inView: false }],
    ["the window is hidden", { active: true, shown: false }],
    ["Reduce Motion is on", { active: true, motion: false }],
  ])("nothing ticks when %s", async (_, gates) => {
    const steps: number[] = [];
    const clock = new LiveClock((step) => steps.push(step));

    clock.set(gates);
    await wait(LIVE_FRAME_MS * 3);

    expect(clock.running).toBe(false);
    expect(steps).toEqual([]);
    clock.dispose();
  });
});
