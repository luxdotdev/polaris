import { describe, expect, test } from "bun:test";
import { ditherClock } from "./clock.ts";

/** A clock whose loops are numbered, with each loop's interrupt and whether it is still running. */
const fakeClock = () => {
  const loops: Array<{ readonly interrupt: () => void; running: boolean }> = [];

  const clock = ditherClock((interrupted) => {
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

describe("the dither clock", () => {
  test("one loop runs for every moving glyph and stops with the last", () => {
    const { clock, running } = fakeClock();
    const first = clock.acquire();
    const second = clock.acquire();

    expect(running()).toBe(1);
    first();
    first();
    expect(running()).toBe(1);
    second();
    expect(running()).toBe(0);
    expect(clock.snapshot().value).toBeNull();
  });

  test("a glyph mounting after the rest left gets a fresh loop", () => {
    const { clock } = fakeClock();

    clock.acquire()();
    clock.acquire();

    expect(clock.snapshot().value).toBe(2);
  });

  test("Reduce Motion stops the loop and keeps glyphs still until it is turned off", () => {
    const { clock, running } = fakeClock();

    clock.acquire();
    clock.setReduceMotion(true);
    clock.acquire();

    expect(running()).toBe(0);
    expect(clock.snapshot()).toEqual({ reduceMotion: true, value: null });

    clock.setReduceMotion(false);
    expect(running()).toBe(1);
  });

  test("a loop that ends on its own is replaced while glyphs still move", () => {
    const { clock, loops, running } = fakeClock();

    clock.acquire();
    loops[0]?.interrupt();

    expect(clock.snapshot().value).toBe(2);
    expect(running()).toBe(1);
  });
});
