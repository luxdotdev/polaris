/** Session State glyphs for chips, tabs and rows, tolerant of Harnesses this build doesn't know. */
import { type HarnessKind, isKnownHarness, type SessionState } from "@polaris/protocol";
import { HarnessMark, StateIcon, type TileSize } from "@polaris/ui";
import type { Density } from "../../shared/api.ts";
import type { Summary } from "../routes/topBar.ts";

interface GlyphProps {
  readonly state: SessionState;
  readonly harness: HarnessKind;
  readonly size?: number;
}

/** A state glyph in a fixed slot; an unknown Harness gets the neutral dot of its state's rank. */
export const SessionGlyph = ({ state, harness, size = 16 }: GlyphProps) =>
  isKnownHarness(harness) ? (
    <StateIcon state={state} harness={harness} size={size} />
  ) : (
    <StateIcon
      state={state === "working" || state === "starting" ? "idle" : state}
      harness="claude"
      size={size}
    />
  );

/** The 12px glyph on a Workspace chip or machine tab: its loudest session, or an empty ring. */
export const SummaryGlyph = ({ summary }: { readonly summary: Summary }) =>
  summary.state === null || summary.harness === null ? (
    <StateIcon state="dormant" harness="claude" size={12} />
  ) : (
    <SessionGlyph state={summary.state} harness={summary.harness} size={12} />
  );

/** DESIGN.md, Density: the session row's Harness tile per step. */
export const TILE_SIZE: Readonly<Record<Density, TileSize>> = {
  calm: 28,
  balanced: 24,
  compact: 20,
};

interface TileProps {
  readonly state: SessionState;
  readonly harness: HarnessKind;
  readonly density: Density;
}

/** A session row's tile: who (the wash) and what (the glyph). */
export const SessionTile = ({ state, harness, density }: TileProps) =>
  isKnownHarness(harness) ? (
    <HarnessMark harness={harness} size={TILE_SIZE[density]} state={state} />
  ) : (
    <span className="size-harness-tile flex items-center justify-center">
      <SessionGlyph state={state} harness={harness} />
    </span>
  );
