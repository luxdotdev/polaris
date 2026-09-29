import type { SessionState } from "@polaris/protocol";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import { HARNESS_NAMES, type Harness } from "../../lib/hue";
import { Dither } from "./dither";
import { StateIcon } from "./state-icon";
import { Tile, type TileSize } from "./tile";

export interface HarnessMarkProps extends HTMLAttributes<HTMLSpanElement> {
  readonly harness: Harness;
  readonly size?: TileSize;
  /** When set, the tile carries the Session State glyph: who (the wash) and what (the glyph). */
  readonly state?: SessionState;
  /** Show the Harness's name beside the tile ("Claude Code"). */
  readonly named?: boolean;
}

function glyphSize(size: TileSize): number {
  return size <= 20 ? 12 : size <= 28 ? 14 : 16;
}

/** A Harness's identity: its hue-washed tile, optionally with its state and name. */
export function HarnessMark({
  harness,
  size = 20,
  state,
  named = false,
  className,
  ...props
}: HarnessMarkProps) {
  const inner = glyphSize(size);

  const tile = (
    <Tile
      hue={harness}
      size={size}
      dormant={state === "dormant"}
      muted={state === "idle"}
      aria-label={named ? undefined : HARNESS_NAMES[harness]}
      role={named ? undefined : "img"}
    >
      {state === undefined ? (
        <Dither hue={harness} size={inner - (inner % 4)} />
      ) : (
        <StateIcon state={state} harness={harness} size={inner} />
      )}
    </Tile>
  );

  if (!named) return tile;

  return (
    <span
      data-slot="harness-mark"
      className={cn("inline-flex items-center gap-1.5 text-label text-text-default", className)}
      {...props}
    >
      {tile}
      {HARNESS_NAMES[harness]}
    </span>
  );
}
