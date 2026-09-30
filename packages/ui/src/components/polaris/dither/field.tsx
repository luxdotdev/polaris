import { type HTMLAttributes, useEffect, useRef } from "react";

import { cn } from "../../../lib/cn";
import type { CssVars } from "../../../lib/css";
import { hueVar, type TintHue } from "../../../lib/hue";
import { DITHER_CELL } from "./frames";
import { type FieldState, paintField, type Ripple, RIPPLE_LIFE_MS } from "./glow";

export interface DitherFieldProps extends HTMLAttributes<HTMLCanvasElement> {
  readonly hue: TintHue;
}

type Rgb = readonly [number, number, number];

/** The canvas's `color` (its hue token) as sRGB bytes, whatever colour space the token uses. */
function resolveRgb(canvas: HTMLCanvasElement): Rgb {
  const probe = document.createElement("canvas");

  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });

  if (context === null) return [255, 255, 255];
  context.fillStyle = getComputedStyle(canvas).color;
  context.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = context.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

function reducedMotion(): boolean {
  const setting = document.documentElement.dataset.reduceMotion;

  if (setting !== undefined) return setting === "true";

  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const PRESENCE_IN_MS = 160;

const PRESENCE_OUT_MS = 320;

const FOLLOW_MS = 40;

interface Motion {
  target: { x: number; y: number };
  pointer: { x: number; y: number };
  presence: number;
  hovered: boolean;
  ripples: Ripple[];
}

/** Advances the glow and ripples by `dt`; returns whether anything is still moving. */
function step(motion: Motion, dt: number): boolean {
  const follow = 1 - Math.exp(-dt / FOLLOW_MS);

  motion.pointer.x += (motion.target.x - motion.pointer.x) * follow;
  motion.pointer.y += (motion.target.y - motion.pointer.y) * follow;
  motion.presence = motion.hovered
    ? Math.min(1, motion.presence + dt / PRESENCE_IN_MS)
    : Math.max(0, motion.presence - dt / PRESENCE_OUT_MS);
  motion.ripples = motion.ripples
    .map((r) => ({ ...r, age: r.age + dt }))
    .filter((r) => r.age < RIPPLE_LIFE_MS);

  const settling =
    Math.abs(motion.target.x - motion.pointer.x) + Math.abs(motion.target.y - motion.pointer.y) >
    0.5;

  const fading = motion.hovered ? motion.presence < 1 : motion.presence > 0;

  return settling || fading || motion.ripples.length > 0;
}

/**
 * The Working strip's dither field (DESIGN.md, Working strip): a still halo that glows and
 * ripples in the hue around the pointer while its `[data-dither-hover]` ancestor is hovered.
 * It paints only while something moves, and never under Reduce Motion.
 */
export function DitherField({ hue, className, style, ...props }: DitherFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === null || context === undefined) return;
    const area = canvas.parentElement;
    const host = canvas.closest<HTMLElement>("[data-dither-hover]") ?? area;

    if (area === null || host === null) return;

    let rgb = resolveRgb(canvas);
    let image = context.createImageData(1, 1);
    let origin = { x: 0, y: 0 };
    let frame = 0;
    let last = 0;

    const motion: Motion = {
      target: { x: 0, y: 0 },
      pointer: { x: 0, y: 0 },
      presence: 0,
      hovered: false,
      ripples: [],
    };

    const paint = (state: FieldState) => {
      paintField({ data: image.data, columns: image.width, rows: image.height }, rgb, state);
      context.putImageData(image, 0, 0);
    };

    const current = (): FieldState => ({
      pointer: motion.pointer,
      presence: motion.presence,
      ripples: motion.ripples,
    });

    // One canvas pixel per cell, shown at exactly 2px so cells stay on the grid.
    const resize = () => {
      const bounds = area.getBoundingClientRect();
      const columns = Math.max(1, Math.ceil(bounds.width / DITHER_CELL));
      const rows = Math.max(1, Math.ceil(bounds.height / DITHER_CELL));

      origin = { x: bounds.left, y: bounds.top };

      if (columns !== canvas.width || rows !== canvas.height) {
        canvas.width = columns;
        canvas.height = rows;
        canvas.style.width = `${columns * DITHER_CELL}px`;
        canvas.style.height = `${rows * DITHER_CELL}px`;
        image = context.createImageData(columns, rows);
      }

      paint(current());
    };

    const tick = (now: number) => {
      const moving = step(motion, Math.min(now - last, 50));

      last = now;
      paint(current());
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
      rgb = resolveRgb(canvas);
      aim(event);

      if (motion.presence === 0) motion.pointer = { ...motion.target };
      motion.hovered = true;
      motion.ripples.push({ ...motion.target, age: 0 });
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (!motion.hovered) return;
      aim(event);
      wake();
    };

    const onDown = (event: PointerEvent) => {
      if (!motion.hovered) return;
      aim(event);
      motion.ripples.push({ ...motion.target, age: 0 });
      wake();
    };

    const onLeave = () => {
      if (!motion.hovered) return;
      motion.hovered = false;
      wake();
    };

    // Repaint the still halo when the theme or hue token changes under it.
    const recolor = () => {
      rgb = resolveRgb(canvas);
      paint(current());
    };

    const observer = new ResizeObserver(resize);
    const themes = new MutationObserver(recolor);
    const scheme = matchMedia("(prefers-color-scheme: dark)");

    observer.observe(area);
    themes.observe(document.documentElement, { attributeFilter: ["data-theme", "class"] });
    scheme.addEventListener("change", recolor);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerleave", onLeave);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      themes.disconnect();
      scheme.removeEventListener("change", recolor);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [hue]);

  const vars: CssVars = { color: hueVar(hue), ...style };

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
