/** Session State glyphs for chips, tabs and rows, tolerant of Harnesses this build doesn't know. */
import { type HarnessKind, isKnownHarness, type SessionState } from "@polaris/protocol";
import { HarnessMark, hueVar, STATE_LABELS, StateIcon, type TileSize } from "@polaris/ui";
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

/** A still dot in the Harness hue for Starting and Working: chips carry no dither. */
const HueDot = ({
  state,
  harness,
}: {
  readonly state: SessionState;
  readonly harness: HarnessKind;
}) => (
  <span
    role="img"
    aria-label={STATE_LABELS[state]}
    data-slot="state-icon"
    data-state={state}
    data-glyph="dot-hue"
    className="inline-flex size-3 shrink-0 items-center justify-center"
  >
    <span
      className="size-[5px] rounded-full"
      style={{
        background: isKnownHarness(harness) ? hueVar(harness) : "var(--color-text-subtle)",
        opacity: state === "starting" ? 0.5 : undefined,
      }}
    />
  </span>
);

/** The 12px glyph on a Workspace chip or machine tab: its loudest session, or an empty ring. */
export const SummaryGlyph = ({ summary }: { readonly summary: Summary }) => {
  const { state, harness } = summary;

  if (state === null || harness === null)
    return <StateIcon state="dormant" harness="claude" size={12} />;

  if (state === "working" || state === "starting")
    return <HueDot state={state} harness={harness} />;

  return <SessionGlyph state={state} harness={harness} size={12} />;
};

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
