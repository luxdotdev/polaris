import { describe, expect, test } from "bun:test";

import { inSky, LAMP_LEVELS, lampLevel, MAX_TWINKLES, twinkleColor } from "./actors";
import { cover, toScene } from "./geometry";
import { SCENES } from "./map";
import { SceneMotion } from "./motion";
import { BIRD_FRAMES, flockOffsets, METEOR_GAP_MS, meteorPath, tailColour } from "./visitors";

const night = SCENES.night;

const dawn = SCENES.dawn;

/** Runs a model in 80ms steps (the layer's rate) and calls `each` after every step. */
const run = (model: SceneMotion, ms: number, each: (t: number) => void) => {
  for (let t = 0; t <= ms; t += 80) {
    model.advance(t);
    each(t);
  }
};

describe("the scene maps", () => {
  test("carry what motion needs", () => {
    expect(night.kind).toBe("night");
    expect(night.stars.length).toBeGreaterThan(100);
    expect(night.skyline).toHaveLength(night.width);
    expect(night.cabin.lamp.length).toBeGreaterThan(0);
    expect(night.meteor).toHaveLength(4);
    expect(dawn.stars).toHaveLength(0);
    expect(dawn.bird).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("twinkling", () => {
  test("a few stars at a time, never more than three", () => {
    const model = new SceneMotion(night, 3);
    let most = 0;
    let seen = 0;

    run(model, 60_000, () => {
      most = Math.max(most, model.twinkles.count);
      seen += model.twinkles.count > 0 ? 1 : 0;
    });

    expect(most).toBeLessThanOrEqual(MAX_TWINKLES);
    expect(seen).toBeGreaterThan(200);
  });

  test("a star brightens a step, then dims toward the sky, in palette colours", () => {
    expect(twinkleColor("#8A96B8", "#0A0D1A", 0.05)).toBe("#BCD3FF");
    expect(twinkleColor("#8A96B8", "#0A0D1A", 0.2)).toBe("#E8EEFF");
    expect(twinkleColor("#8A96B8", "#0A0D1A", 0.55)).toBeNull();
    expect(twinkleColor("#E8EEFF", "#0A0D1A", 0.05)).toBe("#E8EEFF");
  });
});

describe("the lamp", () => {
  test("breathes through its levels, one step at a time: never a strobe", () => {
    const levels = new Set<number>();
    let jumps = 0;
    let previous = lampLevel(0, false);

    for (let t = 0; t < 30_000; t += 80) {
      const level = lampLevel(t, false);

      levels.add(level);
      jumps += Math.abs(level - previous) > 1 ? 1 : 0;
      previous = level;
    }

    expect(jumps).toBe(0);
    expect(levels.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...levels)).toBeLessThan(LAMP_LEVELS);
  });

  test("changes level about once a second, not every frame", () => {
    let changes = 0;

    for (let t = 80; t < 60_000; t += 80)
      changes += lampLevel(t, false) === lampLevel(t - 80, false) ? 0 : 1;

    expect(changes).toBeGreaterThan(10);
    expect(changes).toBeLessThan(120);
  });
});

describe("smoke", () => {
  test("rises from the chimney and drifts with the wind", () => {
    const model = new SceneMotion(night, 5);
    const top = Math.min(...night.cabin.smoke.map(([, y]) => y));
    const xs: number[] = [];

    run(model, 8000, () => {
      for (const p of model.pixels())
        if (p.color === night.cabin.smokeColor) {
          expect(p.y).toBeLessThan(top);
          xs.push(p.x);
        }
    });

    expect(xs.length).toBeGreaterThan(20);
    expect(Math.max(...xs)).toBeGreaterThan(Math.min(...xs));
  });
});

describe("the meteor", () => {
  test("is a whole-pixel streak at one in two", () => {
    const path = meteorPath([100, 10], 1, 6);

    expect(path).toEqual([
      [100, 10],
      [101, 10],
      [102, 11],
      [103, 11],
      [104, 12],
      [105, 12],
    ]);
    expect([0, 1, 2, 3, 5, 6, 8].map(tailColour)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  test("comes rarely, tens of seconds apart, and only over clear sky", () => {
    const model = new SceneMotion(night, 7);
    const card = { x: 110, y: 60, w: 140, h: 70 };
    const starts: number[] = [];
    let flying = false;

    model.setKeepOut([card]);
    run(model, 600_000, (t) => {
      if (model.meteor.flying && !flying) starts.push(t);
      flying = model.meteor.flying;

      model.meteor.paint(t, (p) => expect(inSky(night, [card], [p.x, p.y], 0)).toBe(true));
    });

    expect(starts.length).toBeGreaterThan(3);
    expect(starts.length).toBeLessThan(25);

    for (let i = 1; i < starts.length; i++)
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(METEOR_GAP_MS[0] - 80);
  });

  test("never comes at dawn", () => {
    const model = new SceneMotion(dawn, 7);

    run(model, 200_000, () => expect(model.meteor.flying).toBe(false));
  });
});

describe("the birds", () => {
  test("fly in a V of three or five tiny birds, wings flapping through three frames", () => {
    expect(flockOffsets(3)).toHaveLength(3);
    expect(flockOffsets(5)).toEqual([
      [0, 0],
      [-5, -2],
      [-5, 2],
      [-10, -4],
      [-10, 4],
    ]);
    expect(BIRD_FRAMES).toHaveLength(3);

    for (const frame of BIRD_FRAMES) expect(frame.every((row) => row.length === 3)).toBe(true);
  });

  test("cross the dawn sky now and then, clear of the text", () => {
    const model = new SceneMotion(dawn, 11);
    const text = { x: 100, y: 40, w: 160, h: 30 };
    let flights = 0;
    let flying = false;

    model.setKeepOut([text]);
    run(model, 600_000, () => {
      if (model.flock.flying && !flying) flights++;
      flying = model.flock.flying;

      for (const p of model.pixels())
        if (p.color === dawn.bird) expect(p.y < text.y - 4 || p.y > text.y + text.h + 4).toBe(true);
    });

    expect(flights).toBeGreaterThan(3);
    expect(flights).toBeLessThan(20);
  });

  test("never fly at night", () => {
    const model = new SceneMotion(night, 11);

    run(model, 200_000, () => expect(model.flock.flying).toBe(false));
  });
});

describe("placing the scene", () => {
  test("covers the element from the bottom centre, as the CSS background does", () => {
    const at = cover(1080, 900, 360, 225);

    expect(at.scale).toBe(4);
    expect(at.x).toBe(-180);
    expect(at.y).toBe(0);
    expect(toScene({ left: 400, top: 120, width: 280, height: 100 }, at)).toEqual({
      x: 145,
      y: 30,
      w: 70,
      h: 25,
    });
  });
});
