import { describe, expect, test } from "bun:test";
import { frameClock } from "./clock.ts";

/** A clock whose loops are numbered, with each loop's interrupt and whether it is still running. */
const fakeClock = () => {
  const loops: Array<{ readonly interrupt: () => void; running: boolean }> = [];

  const clock = frameClock((interrupted) => {
    const loop = {
      running: true,
      interrupt: () => {
        loop.running = false;
        interrupted();
      },
    };

    loops.push(loop);

    return {
      value: loops.length,
      stop: () => {
        loop.running = false;
      },
    };
  });

  return { clock, loops, running: () => loops.filter((loop) => loop.running).length };
};

describe("the celestial frame clock", () => {
  test("ten working celestials share one loop, which stops with the last", () => {
    const { clock, loops, running } = fakeClock();
    const releases = Array.from({ length: 10 }, () => clock.acquire());

    expect(loops).toHaveLength(1);

    for (const release of releases.slice(1)) release();
    releases[1]?.();
    expect(running()).toBe(1);
    releases[0]?.();
    expect(running()).toBe(0);
    expect(clock.snapshot().value).toBeNull();
  });

  test("nothing runs until a celestial works", () => {
    const { clock, loops } = fakeClock();
    const listener = { calls: 0 };

    clock.subscribe(() => (listener.calls += 1));
    clock.setForeground(true);

    expect(loops).toHaveLength(0);
    expect(listener.calls).toBe(0);
  });

  test("Reduce Motion stops the loop until it is turned off", () => {
    const { clock, running } = fakeClock();

    clock.acquire();
    clock.setReduceMotion(true);
    expect(running()).toBe(0);
    expect(clock.snapshot()).toEqual({ reduceMotion: true, value: null });

    clock.acquire();
    expect(running()).toBe(0);

    clock.setReduceMotion(false);
    expect(running()).toBe(1);
  });

  test("backgrounding pauses the loop and returning resumes it while something works", () => {
    const { clock, running } = fakeClock();
    const release = clock.acquire();

    clock.setForeground(false);
    expect(running()).toBe(0);
    clock.setForeground(true);
    expect(running()).toBe(1);

    clock.setForeground(false);
    release();
    clock.setForeground(true);
    expect(running()).toBe(0);
  });

  test("a loop React Native ended on its own is replaced while celestials still work", () => {
    const { clock, loops } = fakeClock();

    clock.acquire();
    loops[0]?.interrupt();

    expect(clock.snapshot().value).toBe(2);
  });
});
