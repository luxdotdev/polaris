/**
 * The game loop: fixed 60 Hz ticks driven by animation frames (catching up at
 * most a few ticks after a stall), held keys, and the playfield's colours read
 * from the theme. Runs only while the card is mounted.
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import type { GameStatus } from "../model/game.ts";

const TICK_MS = 1000 / 60;

const MAX_CATCH_UP = 5;
/** Frames between re-reading the theme's colours, so a theme switch mid-game follows. */

const COLOUR_EVERY = 60;

export interface FieldColours {
  readonly ink: string;
  readonly subtle: string;
  readonly faint: string;
  readonly star: string;
  readonly ground: string;
}

/** The colour keys and the CSS each is read from; the Night ground has no token (DESIGN.md, Brand colours). */
export const FIELD_COLOURS: Readonly<Record<keyof FieldColours, string>> = {
  ink: "var(--color-text-strong)",
  subtle: "var(--color-text-subtle)",
  faint: "var(--color-text-faint)",
  star: "light-dark(transparent, #262c48)",
  ground: "light-dark(#dcdde1, #262c48)",
};

export const FIELD_GROUND = "light-dark(var(--color-surface-sunken), #0a0d1a)";

/** What a held key means to a game. */
export type GameKey = "left" | "right" | "up" | "down" | "fire";

/** Game keys by `KeyboardEvent.code`. */
const KEYS = new Map<string, GameKey>([
  ["ArrowLeft", "left"],
  ["KeyA", "left"],
  ["ArrowRight", "right"],
  ["KeyD", "right"],
  ["ArrowUp", "up"],
  ["KeyW", "up"],
  ["ArrowDown", "down"],
  ["KeyS", "down"],
  ["Space", "fire"],
]);

export type Held = ReadonlySet<GameKey>;

export interface GameSpec<S extends { readonly status: GameStatus }> {
  readonly start: () => S;
  readonly step: (state: S, held: Held) => S;
  readonly draw: (g: CanvasRenderingContext2D, state: S, colours: FieldColours) => void;
  readonly togglePause: (state: S) => S;
}

const readColours = (swatches: HTMLElement | null): FieldColours | null => {
  if (swatches === null) return null;

  const read = (key: string) => {
    const swatch = swatches.querySelector<HTMLElement>(`[data-swatch="${key}"]`);

    return swatch === null ? "transparent" : getComputedStyle(swatch).color;
  };

  return {
    ink: read("ink"),
    subtle: read("subtle"),
    faint: read("faint"),
    star: read("star"),
    ground: read("ground"),
  };
};

export interface GameHandle<S> {
  /** What the header and the message over the field show; changes only when they do. */
  readonly state: S;
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly swatches: RefObject<HTMLDivElement | null>;
}

/**
 * The game's keys, on the document while it runs: the dialog holds focus itself,
 * above anything inside it. Handled keys are taken from the shell's shortcuts.
 */
const useKeys = <S extends { readonly status: GameStatus }>(
  spec: GameSpec<S>,
  current: { current: S },
  held: Set<GameKey>
) => {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = KEYS.get(event.code);

      if (key !== undefined) held.add(key);
      else if (event.code === "KeyP") current.current = spec.togglePause(current.current);
      else if (event.code === "Enter" && current.current.status === "over") {
        current.current = spec.start();
      } else return;
      event.preventDefault();
    };

    const up = (event: KeyboardEvent) => {
      const key = KEYS.get(event.code);

      if (key !== undefined) held.delete(key);
    };

    // A key released while the window was away never sends its keyup.
    const release = () => held.clear();

    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", release);

    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [spec, current, held]);
};

/**
 * Runs a game. `shown` picks what the header needs from a state, so React
 * renders when the score changes rather than every tick.
 */
export const useGame = <S extends { readonly status: GameStatus }>(
  spec: GameSpec<S>,
  shown: (state: S) => string
): GameHandle<S> => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const swatches = useRef<HTMLDivElement>(null);
  const current = useRef<S>(spec.start());
  const [held] = useState(() => new Set<GameKey>());
  const [state, setState] = useState(current.current);

  useKeys(spec, current, held);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let pending = 0;
    let frames = 0;
    let colours: FieldColours | null = null;
    let seen = shown(current.current);

    const run = (now: number) => {
      pending = Math.min(pending + (now - last), TICK_MS * MAX_CATCH_UP);
      last = now;

      while (pending >= TICK_MS) {
        current.current = spec.step(current.current, held);
        pending -= TICK_MS;
      }

      if (colours === null || frames % COLOUR_EVERY === 0) colours = readColours(swatches.current);
      frames += 1;
      const g = canvas.current?.getContext("2d");

      if (g != null && colours !== null) spec.draw(g, current.current, colours);
      const next = shown(current.current);

      if (next !== seen) {
        seen = next;
        setState(current.current);
      }

      frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);

    return () => cancelAnimationFrame(frame);
  }, [spec, shown, held]);

  return { state, canvas, swatches };
};
