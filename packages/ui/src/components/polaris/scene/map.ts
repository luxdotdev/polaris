/**
 * What a scene's ambient motion may touch, written by design/scripts/gen_textures.py beside each
 * scene PNG: the stars (and the sky under each), the sky line, the cabin's lamp, door gap and
 * smoke, and the colours a meteor or a bird is drawn in. Coordinates are scene pixels.
 */
import dawn from "../../../../../../design/assets/scenes/scene-dawn.json";
import night from "../../../../../../design/assets/scenes/scene-night.json";

export type Point = readonly [x: number, y: number];

export interface CabinMap {
  readonly lamp: readonly Point[];
  readonly lampColor: string;
  readonly door: readonly Point[];
  readonly doorColor: string;
  readonly smoke: readonly Point[];
  readonly smokeColor: string;
  readonly chimney: Point;
}

export interface SceneMap {
  readonly kind: "night" | "dawn";
  readonly width: number;
  readonly height: number;
  /** Each star: x, y, its colour, and the sky colour under it. */
  readonly stars: ReadonlyArray<readonly [number, number, string, string]>;
  /** The top row of the hills (and pines) in each column. */
  readonly skyline: readonly number[];
  readonly cabin: CabinMap;
  /** A meteor's head, then its tail as it cools; empty at dawn. */
  readonly meteor: readonly string[];
  /** The silhouette colour of birds; null at night. */
  readonly bird: string | null;
}

/** A scene-pixel rectangle that motion keeps clear of (text, the setup card). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The JSON as written: tuples widen to arrays and literals to strings. */
interface SceneJson {
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  readonly stars: readonly (readonly (string | number)[])[];
  readonly skyline: readonly number[];
  readonly cabin: {
    readonly lamp: readonly (readonly number[])[];
    readonly lampColor: string;
    readonly door: readonly (readonly number[])[];
    readonly doorColor: string;
    readonly smoke: readonly (readonly number[])[];
    readonly smokeColor: string;
    readonly chimney: readonly number[];
  };
  readonly meteor?: readonly string[];
  readonly bird?: string;
}

const point = (p: readonly number[]): Point => [p[0] ?? 0, p[1] ?? 0];

/** Narrows the generated JSON to a SceneMap, field by field. */
const sceneMap = (json: SceneJson): SceneMap => ({
  kind: json.kind === "dawn" ? "dawn" : "night",
  width: json.width,
  height: json.height,
  stars: json.stars.map((s) => [Number(s[0]), Number(s[1]), String(s[2]), String(s[3])] as const),
  skyline: json.skyline,
  cabin: {
    ...json.cabin,
    lamp: json.cabin.lamp.map(point),
    door: json.cabin.door.map(point),
    smoke: json.cabin.smoke.map(point),
    chimney: point(json.cabin.chimney),
  },
  meteor: json.meteor ?? [],
  bird: json.bird ?? null,
});

export const SCENES: Readonly<Record<SceneMap["kind"], SceneMap>> = {
  night: sceneMap(night),
  dawn: sceneMap(dawn),
};
