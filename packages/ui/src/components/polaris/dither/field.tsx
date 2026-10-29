import { type HTMLAttributes, useEffect, useRef } from "react";

import { cn } from "../../../lib/cn";
import type { CssVars } from "../../../lib/css";
import { hueVar, type TintHue } from "../../../lib/hue";
import { reducedMotion } from "../../../lib/motion";
import { LiveClock, watchGates } from "./clock";
import {
  BLOOM_MS,
  bloomAt,
  DOT_PITCH,
  type FieldColors,
  type FieldFrame,
  HUE_ALPHA,
  liveAt,
  paintFrame,
  RESTING,
  type Rgb,
  Trail,
  WASH_ALPHA,
} from "./glow";

export interface DitherFieldProps extends HTMLAttributes<HTMLCanvasElement> {
  readonly hue: TintHue;
  /** A change (a new status line) re-blooms the corner, as does mounting; unset never blooms. */
  readonly bloom?: string | undefined;
  /** While a Turn runs the threshold drifts and the edge breathes at 12 fps (LiveClock). */
  readonly active?: boolean | undefined;
}

/** A resolved CSS colour as sRGB bytes, whatever colour space the token uses. */
function toRgb(css: string): Rgb {
  const probe = document.createElement("canvas");

  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });

  if (context === null) return [255, 255, 255];
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = context.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

/** The hue is the canvas's `color`; the sparse dots take its `outline-color` (text-strong). */
function resolveColors(canvas: HTMLCanvasElement): FieldColors {
  const style = getComputedStyle(canvas);
  const sparse = toRgb(style.outlineColor);
  const light = sparse[0] + sparse[1] + sparse[2] < 384;

  // Light ground: the hue needs a little more alpha to read at the same weight.
  return {
    hue: toRgb(style.color),
    sparse,
    hueAlpha: light ? HUE_ALPHA * 1.25 : HUE_ALPHA,
    washAlpha: light ? WASH_ALPHA * 0.6 : WASH_ALPHA,
  };
}

const PRESENCE_IN_MS = 90;

const PRESENCE_OUT_MS = 160;

const FOLLOW_MS = 30;

interface Motion {
  target: { x: number; y: number };
  pointer: { x: number; y: number };
  presence: number;
  hovered: boolean;
  /** Milliseconds since the last bloom began; BLOOM_MS or more is at rest. */
  bloomAge: number;
  trail: Trail | null;
}

/** Advances the pointer, the patch, the trail and the bloom by `dt`; true while any moves. */
function step(motion: Motion, dt: number): boolean {
  const follow = 1 - Math.exp(-dt / FOLLOW_MS);

  motion.pointer.x += (motion.target.x - motion.pointer.x) * follow;
  motion.pointer.y += (motion.target.y - motion.pointer.y) * follow;
  motion.presence = motion.hovered
    ? Math.min(1, motion.presence + dt / PRESENCE_IN_MS)
    : Math.max(0, motion.presence - dt / PRESENCE_OUT_MS);
  motion.bloomAge += dt;

  const trailing =
    motion.trail?.update(dt, motion.pointer.x, motion.pointer.y, motion.presence) ?? false;

  const settling =
    Math.abs(motion.target.x - motion.pointer.x) + Math.abs(motion.target.y - motion.pointer.y) >
    0.5;

  const fading = motion.hovered ? motion.presence < 1 : motion.presence > 0;

  return settling || fading || trailing || motion.bloomAge < BLOOM_MS;
}

interface Controller {
  readonly bloom: () => void;
  readonly clock: LiveClock;
}

/**
 * The live dither field (DESIGN.md, Working strip): fine hue dots at the top-left that drift
 * and breathe while `active`, a trail and sparse bright dots around the pointer while its
 * `[data-dither-hover]` ancestor is hovered, and a bloom on each status. It paints only while
 * something moves; hidden, out of view or under Reduce Motion it is the still corner.
 */
export function DitherField({
  hue,
  bloom,
  active = false,
  className,
  style,
  ...props
}: DitherFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === null || context === undefined) return;
    const area = canvas.parentElement;
    const host = canvas.closest<HTMLElement>("[data-dither-hover]");

    if (area === null) return;

    let colors = resolveColors(canvas);
    let image = context.createImageData(1, 1);
    let pixels = new Uint32Array(image.data.buffer);
    let origin = { x: 0, y: 0 };
    let frame = 0;
    let last = 0;
    let live = liveAt(0);

    const motion: Motion = {
      target: { x: 0, y: 0 },
      pointer: { x: 0, y: 0 },
      presence: 0,
      hovered: false,
      bloomAge: BLOOM_MS,
      trail: null,
    };

    const current = (): FieldFrame => ({
      bloom: motion.bloomAge >= BLOOM_MS ? RESTING : bloomAt(motion.bloomAge),
      ...live,
      trail: motion.trail,
      pointer: motion.pointer,
      presence: motion.presence,
    });

    const paint = () => {
      paintFrame({ pixels, width: image.width, height: image.height }, colors, current());
      context.putImageData(image, 0, 0);
    };

    // One canvas pixel per CSS px, scaled up unsmoothed, so a dot is a crisp square.
    const resize = () => {
      const bounds = area.getBoundingClientRect();
      const width = Math.max(1, Math.floor(bounds.width));
      const height = Math.max(1, Math.floor(bounds.height));

      origin = { x: bounds.left, y: bounds.top };

      if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        image = context.createImageData(width, height);
        pixels = new Uint32Array(image.data.buffer);
        motion.trail = new Trail(Math.ceil(width / DOT_PITCH), Math.ceil(height / DOT_PITCH));
      }

      paint();
    };

    const tick = (now: number) => {
      const moving = step(motion, Math.min(now - last, 50));

      last = now;
      paint();
      frame = moving ? requestAnimationFrame(tick) : 0;
    };

    const wake = () => {
      if (frame !== 0) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const aim = (event: PointerEvent) => {
      motion.target = { x: event.clientX - origin.x, y: event.clientY - origin.y };
    };

    const onEnter = (event: PointerEvent) => {
      if (reducedMotion()) return;
      const bounds = area.getBoundingClientRect();

      origin = { x: bounds.left, y: bounds.top };
      aim(event);

      if (motion.presence === 0) motion.pointer = { ...motion.target };
      motion.hovered = true;
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (!motion.hovered) return;
      aim(event);
      wake();
    };

    const onLeave = () => {
      if (!motion.hovered) return;
      motion.hovered = false;
      wake();
    };

    // Repaint when the theme or hue token changes under it.
    const recolor = () => {
      colors = resolveColors(canvas);
      paint();
    };

    // A live step repaints, unless the pointer's frame loop is about to.
    const clock = new LiveClock((step) => {
      live = liveAt(step);

      if (frame === 0) paint();
    });

    const unwatch = watchGates(canvas, clock);
    const observer = new ResizeObserver(resize);
    const themes = new MutationObserver(recolor);
    const scheme = matchMedia("(prefers-color-scheme: dark)");

    observer.observe(area);
    themes.observe(document.documentElement, { attributeFilter: ["data-theme", "class"] });
    scheme.addEventListener("change", recolor);
    host?.addEventListener("pointerenter", onEnter);
    host?.addEventListener("pointermove", onMove);
    host?.addEventListener("pointerleave", onLeave);
    resize();

    controller.current = {
      bloom: () => {
        if (reducedMotion()) return;
        colors = resolveColors(canvas);
        motion.bloomAge = 0;
        wake();
      },
      clock,
    };

    return () => {
      controller.current = null;
      clock.dispose();
      unwatch();
      cancelAnimationFrame(frame);
      observer.disconnect();
      themes.disconnect();
      scheme.removeEventListener("change", recolor);
      host?.removeEventListener("pointerenter", onEnter);
      host?.removeEventListener("pointermove", onMove);
      host?.removeEventListener("pointerleave", onLeave);
    };
  }, [hue]);

  useEffect(() => {
    if (bloom !== undefined) controller.current?.bloom();
  }, [hue, bloom]);

  useEffect(() => controller.current?.clock.set({ active }), [hue, active]);

  const vars: CssVars = {
    color: hueVar(hue),
    outlineColor: "var(--color-text-strong)",
    ...style,
  };

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-slot="dither-field"
      className={cn("pixelated pointer-events-none absolute top-0 left-0", className)}
      style={vars}
      {...props}
    />
  );
}
