/**
 * A scene's ambient life as one deterministic model: advance it to a time, read the pixels to
 * draw over the still scene. Seeded, so tests replay it exactly; the layer drives it in time.
 */
import { Lamp, type Pixel, Smoke, Twinkles } from "./actors";
import { seeded } from "./colour";
import type { Rect, SceneMap } from "./map";
import { Flock, Meteor } from "./visitors";

export class SceneMotion {
  readonly twinkles: Twinkles;
  readonly lamp: Lamp;
  readonly smoke: Smoke;
  readonly meteor: Meteor;
  readonly flock: Flock;
  private keepOut: readonly Rect[] = [];
  private t = 0;

  constructor(
    readonly map: SceneMap,
    seed = 1
  ) {
    const random = seeded(seed);

    this.twinkles = new Twinkles(map, random);
    this.lamp = new Lamp(map.cabin, random);
    this.smoke = new Smoke(map.cabin, random);
    this.meteor = new Meteor(map, random);
    this.flock = new Flock(map, random);
  }

  /** Text and the setup card, in scene pixels: visitors never cross them. */
  setKeepOut(rects: readonly Rect[]) {
    this.keepOut = rects;
  }

  get time() {
    return this.t;
  }

  /** Moves the model to `t` ms; time only goes forward. */
  advance(t: number) {
    this.t = Math.max(this.t, t);
    this.twinkles.advance(this.t);
    this.lamp.advance(this.t);
    this.smoke.advance(this.t);
    this.meteor.advance(this.t, this.keepOut);
    this.flock.advance(this.t, this.keepOut);
  }

  /** Brings the meteor (night) or the flock (dawn) now, for screenshots and frame checks. */
  summon() {
    this.meteor.summon(this.t);
    this.flock.summon(this.t);
  }

  /** Every pixel to draw now, inside the scene. */
  pixels(): Pixel[] {
    const out: Pixel[] = [];
    const { width, height } = this.map;

    const paint = (p: Pixel) => {
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) out.push(p);
    };

    this.twinkles.paint(this.t, paint);
    this.lamp.paint(this.t, paint);
    this.smoke.paint(this.t, paint);
    this.meteor.paint(this.t, paint);
    this.flock.paint(this.t, paint);

    return out;
  }
}

/** A stable key for a frame's pixels, so an unchanged frame is not painted again. */
export const frameKey = (pixels: readonly Pixel[]) =>
  pixels.map((p) => `${p.x},${p.y},${p.color},${p.alpha}`).join(";");
