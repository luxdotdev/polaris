import { describe, expect, test } from "bun:test";
import { badgeColors, badgeText, type Bitmap, starInk, taskbarBadge, trayStar } from "./pixels.ts";

/** The pixel at (x, y) as "#RRGGBB" and alpha 0–255, reading BGRA. */
const at = ({ size, pixels }: Bitmap, x: number, y: number) => {
  const i = (y * size + x) * 4;

  const hex = [pixels[i + 2], pixels[i + 1], pixels[i]]
    .map((c) => (c ?? 0).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return { color: `#${hex}`, alpha: pixels[i + 3] ?? 0 };
};

describe("badgeText", () => {
  test("none at zero, the count to 9, then 9+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
    expect(badgeText(250)).toBe("9+");
  });
});

describe("trayStar", () => {
  test("draws the star in the taskbar's ink at 1x and 2x", () => {
    for (const scale of [1, 2]) {
      const star = trayStar(scale, starInk(true), null);

      expect(star.size).toBe(16 * scale);
      expect(at(star, 8 * scale, 8 * scale)).toEqual({ color: "#FFFFFF", alpha: 255 });
      expect(at(star, 0, 0).alpha).toBe(0);
    }
  });

  test("the needs-you dot sits at the lower right, in the token for the taskbar's mode", () => {
    for (const dark of [true, false]) {
      const star = trayStar(1, starInk(dark), badgeColors(dark).fill);

      expect(at(star, 13, 13)).toEqual({ color: badgeColors(dark).fill, alpha: 255 });
    }
  });

  test("without a dot the lower right stays the star's own", () => {
    expect(at(trayStar(1, "#000000", null), 13, 13).alpha).toBe(0);
  });
});

describe("taskbarBadge", () => {
  test("a needs-you disc with ink digits, legible in both taskbar modes", () => {
    for (const dark of [true, false]) {
      const { fill, ink } = badgeColors(dark);
      const badge = taskbarBadge(1, "2", dark);

      expect(at(badge, 8, 2)).toEqual({ color: fill, alpha: 255 });
      // The "2"'s top bar, centred: columns 6–8, row 5.
      expect(at(badge, 7, 5)).toEqual({ color: ink, alpha: 255 });
      expect(at(badge, 0, 0).alpha).toBe(0);
    }
  });

  test("9+ fits inside the disc at 1x and 2x", () => {
    for (const scale of [1, 2]) {
      const badge = taskbarBadge(scale, "9+", true);
      let inkLeft = Number.POSITIVE_INFINITY;
      let inkRight = 0;

      for (let y = 0; y < badge.size; y++) {
        for (let x = 0; x < badge.size; x++) {
          if (at(badge, x, y).color !== badgeColors(true).ink) continue;
          inkLeft = Math.min(inkLeft, x);
          inkRight = Math.max(inkRight, x);
        }
      }

      expect(inkLeft).toBeGreaterThanOrEqual(3 * scale);
      expect(inkRight).toBeLessThan(13 * scale);
    }
  });
});
