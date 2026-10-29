import { reducedMotion } from "../../../lib/motion";
import { LIVE_FRAME_MS } from "./glow";

/** What may stop a live field: each must allow it before the clock ticks. */
export interface LiveGates {
  /** The Turn is running (the `active` prop). */
  active: boolean;
  /** Some of the field is in the viewport. */
  inView: boolean;
  /** The window isn't hidden. */
  shown: boolean;
  /** The app's Motion setting, else the system's, allows motion. */
  motion: boolean;
}

export const ticks = (gates: LiveGates): boolean =>
  gates.active && gates.inView && gates.shown && gates.motion;

/**
 * The live field's 12 fps clock: one timer, running only while every gate allows, so nothing
 * wakes when no Turn runs. `onStep` gets the step, 0 when it stops.
 */
export class LiveClock {
  readonly gates: LiveGates = { active: false, inView: true, shown: true, motion: true };
  private timer: ReturnType<typeof setInterval> | undefined;
  private step = 0;

  constructor(private readonly onStep: (step: number) => void) {}

  /** Changes gates and starts or stops the timer to match. */
  set(change: Partial<LiveGates>): void {
    Object.assign(this.gates, change);
    const running = this.timer !== undefined;

    if (ticks(this.gates) === running) return;

    if (running) return this.halt();
    this.timer = setInterval(() => {
      this.step++;
      this.onStep(this.step);
    }, LIVE_FRAME_MS);
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  private halt(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.step = 0;
    this.onStep(0);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** Watches what gates a live field on `element`: its visibility, the window's, Reduce Motion. */
export function watchGates(element: Element, clock: LiveClock): () => void {
  const intersection = new IntersectionObserver((entries) => {
    const last = entries.at(-1);

    if (last !== undefined) clock.set({ inView: last.isIntersecting });
  });

  const onVisibility = () => clock.set({ shown: document.visibilityState === "visible" });
  const onMotion = () => clock.set({ motion: !reducedMotion() });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const setting = new MutationObserver(onMotion);

  intersection.observe(element);
  document.addEventListener("visibilitychange", onVisibility);
  reduce.addEventListener("change", onMotion);
  setting.observe(document.documentElement, { attributeFilter: ["data-reduce-motion"] });
  onVisibility();
  onMotion();

  return () => {
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    reduce.removeEventListener("change", onMotion);
    setting.disconnect();
  };
}
