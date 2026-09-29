import type { SessionState } from "@polaris/protocol";
import type { HTMLAttributes, ReactNode } from "react";

import {
  PixelArchiveIcon,
  PixelFailedIcon,
  PixelHandIcon,
  PixelTerminalIcon,
} from "../../icons/pixel";
import { cn } from "../../lib/cn";
import type { Harness } from "../../lib/hue";
import { useExitPresence } from "../../lib/presence";
import { DITHER_EXIT_MS, Dither } from "./dither";

export type { SessionState };

/** The form a Session State takes. Never a label and never colour alone (rule/severity-vs-state). */
export type StateGlyph =
  | "dither-still"
  | "dither-moving"
  | "pixel-hand"
  | "dot-solid"
  | "pixel-terminal"
  | "dot-hollow"
  | "pixel-failed"
  | "pixel-archive";

export const SESSION_STATES: readonly SessionState[] = [
  "starting",
  "working",
  "needs-you",
  "idle",
  "in-terminal",
  "dormant",
  "failed",
  "archived",
];

/** DESIGN.md's Session State table. */
export const STATE_GLYPHS: Record<SessionState, StateGlyph> = {
  starting: "dither-still",
  working: "dither-moving",
  "needs-you": "pixel-hand",
  idle: "dot-solid",
  "in-terminal": "pixel-terminal",
  dormant: "dot-hollow",
  failed: "pixel-failed",
  archived: "pixel-archive",
};

/** Accessible names, in product copy (rule/glossary-lowercase). */
export const STATE_LABELS: Record<SessionState, string> = {
  starting: "Starting",
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
  "in-terminal": "In terminal",
  dormant: "Dormant",
  failed: "Failed",
  archived: "Archived",
};

export interface StateIconProps extends HTMLAttributes<HTMLSpanElement> {
  readonly state: SessionState;
  /** Starting and Working take the Harness hue. */
  readonly harness: Harness;
  /** The slot is 16px in chips, menus and compact lists; glyphs sit inside it. */
  readonly size?: number;
}

function glyph(state: SessionState, harness: Harness, size: number): ReactNode {
  const pixel = Math.round(size * 0.875);
  const dot = Math.max(4, Math.round(size * 0.375));
  const dither = size - (size % 2);

  const glyphs: Record<StateGlyph, () => ReactNode> = {
    "dither-still": () => <Dither hue={harness} size={dither} dim />,
    "dither-moving": () => <Dither hue={harness} size={dither} moving />,
    "pixel-hand": () => <PixelHandIcon size={pixel} className="text-needs-you" />,
    "dot-solid": () => (
      <span className="bg-text-subtle rounded-full" style={{ width: dot, height: dot }} />
    ),
    "pixel-terminal": () => <PixelTerminalIcon size={pixel} className="text-text-subtle" />,
    "dot-hollow": () => (
      <span className="border-text-faint rounded-full border" style={{ width: dot, height: dot }} />
    ),
    "pixel-failed": () => <PixelFailedIcon size={pixel} className="text-failed" />,
    "pixel-archive": () => <PixelArchiveIcon size={pixel} className="text-text-faint" />,
  };

  return glyphs[STATE_GLYPHS[state]]();
}

/**
 * A Session State as a glyph in a fixed slot: the only looping motion is Working's dither
 * (rule/only-working-moves), and Needs You is the only attention colour.
 */
export function StateIcon({ state, harness, size = 16, className, ...props }: StateIconProps) {
  const leavingWorking = useExitPresence(state === "working", DITHER_EXIT_MS);

  return (
    <span
      role="img"
      aria-label={STATE_LABELS[state]}
      data-slot="state-icon"
      data-state={state}
      data-glyph={STATE_GLYPHS[state]}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      {glyph(state, harness, size)}
      {leavingWorking ? (
        <Dither
          hue={harness}
          size={size - (size % 2)}
          moving
          leaving
          className="absolute inset-0 m-auto"
        />
      ) : null}
    </span>
  );
}
