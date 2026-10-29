/** Star chart fixtures for the gallery: MX-W's 12 tasks, a 14-wave chart that wraps, and 64 tasks. */
import type { StarBand, StarState, StarTask } from "./types.ts";

export const BANDS: ReadonlyArray<StarBand> = [
  { id: "a", letter: "A", name: "protocol" },
  { id: "b", letter: "B", name: "daemon" },
  { id: "c", letter: "C", name: "mobile" },
  { id: "d", letter: "D", name: "desktop" },
  { id: "e", letter: "E", name: "docs" },
];

const star = (
  id: string,
  wave: number,
  state: StarState,
  dependsOn: ReadonlyArray<string> = []
): StarTask => ({
  id,
  label: `Task ${id}`,
  band: id[0]!.toLowerCase(),
  wave,
  state,
  dependsOn,
});

/** Paper MX-W: 5 of 12 done, a claim to review, one blocked. */
export const SMALL: ReadonlyArray<StarTask> = [
  star("A1", 1, "done"),
  star("A2", 2, "done", ["A1"]),
  star("A2b", 2, "done", ["A1"]),
  star("A3", 3, "working", ["A2", "A2b"]),
  star("A4", 4, "waiting", ["A3"]),
  star("B1", 1, "done"),
  star("B2", 2, "done", ["B1"]),
  star("B3", 3, "review", ["B2"]),
  star("B4", 4, "waiting", ["B3"]),
  star("C3", 3, "working", ["B2"]),
  star("C4", 4, "blocked", ["C3"]),
  star("B5", 5, "waiting", ["A4", "B4", "C4"]),
];

/** Fourteen waves in two bands: more than a phone's width holds, so the waves wrap. */
export const WRAPPING: ReadonlyArray<StarTask> = Array.from({ length: 14 }, (_, i) => [
  star(
    `A${i + 1}`,
    i + 1,
    i < 6 ? "done" : i === 6 ? "working" : "waiting",
    i === 0 ? [] : [`A${i}`]
  ),
  ...(i % 3 === 0 ? [star(`B${i + 1}`, i + 1, i < 6 ? "done" : "waiting", [`A${i + 1}`])] : []),
]).flat();

const STATES: ReadonlyArray<StarState> = ["done", "done", "done", "working", "review", "waiting"];

/** 64 tasks over five bands: past 30, so MX-X's dots. */
export const LARGE: ReadonlyArray<StarTask> = Array.from({ length: 64 }, (_, i) => {
  const band = BANDS[i % 5]!;
  const wave = Math.floor(i / 5) + 1;
  const state = i === 37 ? "failed" : (STATES[Math.min(5, Math.floor(wave / 2.4))] ?? "waiting");

  return {
    id: `${band.letter}${wave}`,
    label: `Task ${band.letter}${wave}`,
    band: band.id,
    wave,
    state,
  };
});
