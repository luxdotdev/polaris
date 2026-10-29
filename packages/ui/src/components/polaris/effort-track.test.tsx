import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { EffortTrack, effortCells, effortKey, effortNearest, effortThumbX } from "./effort-track";

afterEach(cleanup);

const LEVELS = ["low", "medium", "high", "max"];

const litIn = (from: number, to: number, width = 316) =>
  effortCells(width).filter((c) => c.x >= from && c.x < to).length;

const labels = (levels: readonly string[], value: number) =>
  [
    ...render(
      <EffortTrack levels={levels} value={value} hue="claude" />
    ).container.querySelectorAll("[aria-hidden] > span"),
  ].map((span) => span.textContent);

describe("the effort track", () => {
  test("every level is labelled while the labels fit", () => {
    expect(labels(["low", "medium", "high", "xhigh", "max"], 2)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("crowded labels give way to the chosen level's and the ends that still fit", () => {
    const many = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ludicrous"];

    expect(labels(many, 3)).toEqual(["minimal", "high", "ludicrous"]);
    // Beside an end, the chosen level's label wins and that end's gives way.
    expect(labels(many, 1)).toEqual(["low", "ludicrous"]);
  });

  test("the field thickens along the track, sparse at low and full at max", () => {
    const quarters = [0, 1, 2, 3].map((q) => litIn(q * 79, (q + 1) * 79));

    for (let i = 1; i < quarters.length; i++)
      expect(quarters[i] ?? 0).toBeGreaterThan(quarters[i - 1] ?? 0);

    // The last 8px is solid: every cell of 4 columns × 6 rows.
    expect(litIn(308, 316)).toBe(24);
    expect(litIn(0, 8)).toBeLessThan(6);
  });

  test("the thumb sits at each level's place, ends flush with the track", () => {
    expect(effortThumbX(0, 4, 316)).toBe(0);
    expect(effortThumbX(3, 4, 316)).toBeLessThanOrEqual(316 - 3);
    expect(effortThumbX(3, 4, 316)).toBeGreaterThan(310);
    expect(effortThumbX(1, 4, 316)).toBeLessThan(effortThumbX(2, 4, 316));
  });

  test("a press picks the nearest level and holds at the ends", () => {
    expect(effortNearest(-40, 4, 316)).toBe(0);
    expect(effortNearest(100, 4, 316)).toBe(1);
    expect(effortNearest(220, 4, 316)).toBe(2);
    expect(effortNearest(900, 4, 316)).toBe(3);
  });

  test("arrows step, Home and End jump, and the ends hold", () => {
    expect(effortKey("ArrowRight", 1, 4)).toBe(2);
    expect(effortKey("ArrowLeft", 1, 4)).toBe(0);
    expect(effortKey("Home", 3, 4)).toBe(0);
    expect(effortKey("End", 1, 4)).toBe(3);
    expect(effortKey("ArrowRight", 3, 4)).toBeNull();
    expect(effortKey("Enter", 2, 4)).toBeNull();
  });

  test("the hue fills only up to the thumb; the rest of the field stays neutral", () => {
    const { container } = render(<EffortTrack levels={LEVELS} value={2} hue="claude-code" />);
    const lit = container.querySelector("[data-part=lit]")?.getAttribute("d") ?? "";
    const unlit = container.querySelector("[data-part=unlit]")?.getAttribute("d") ?? "";
    const thumb = Number(container.querySelector("[data-part=thumb]")?.getAttribute("x"));
    const xs = (d: string) => [...d.matchAll(/M(\d+) /g)].map((m) => Number(m[1]));

    expect(Math.max(...xs(lit))).toBeLessThan(thumb);
    expect(Math.min(...xs(unlit))).toBeGreaterThanOrEqual(thumb);
  });

  test("a key on the slider reports the next level and names it", () => {
    const picks: number[] = [];

    const { getByRole } = render(
      <EffortTrack levels={LEVELS} value={1} hue="codex" onChange={(i) => picks.push(i)} />
    );

    const slider = getByRole("slider");

    expect(slider.getAttribute("aria-valuetext")).toBe("medium");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(picks).toEqual([2, 0]);
  });
});
