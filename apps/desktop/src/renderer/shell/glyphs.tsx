/** Session State glyphs for chips, tabs and rows, tolerant of Harnesses this build doesn't know. */
import {
  type CelestialBody,
  type HarnessKind,
  isKnownHarness,
  type SessionState,
} from "@polaris/protocol";
import {
  Celestial,
  type CelestialSize,
  hueVar,
  sessionCelestial,
  STATE_LABELS,
  StateIcon,
} from "@polaris/ui";
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

/** DESIGN.md, Celestials: the session row's Celestial per density step. */
export const CELESTIAL_SIZE: Readonly<Record<Density, CelestialSize>> = {
  calm: 24,
  balanced: 16,
  compact: 16,
};

interface TileProps {
  readonly state: SessionState;
  readonly harness: HarnessKind;
  readonly density: Density;
  /** The session's planet (`session.celestial`); null from a Daemon before Celestials. */
  readonly celestial: CelestialBody | null | undefined;
  /** A Lead shows its star. */
  readonly lead?: boolean;
}

/** A session's Celestial, centred in the row's mark slot. */
export const SessionTile = ({ state, harness, density, celestial, lead = false }: TileProps) => (
  <span className="size-harness-tile flex shrink-0 items-center justify-center">
    <Celestial
      body={sessionCelestial(celestial, lead)}
      harness={harness}
      size={CELESTIAL_SIZE[density]}
      working={state === "working"}
      dormant={state === "dormant" || state === "archived"}
    />
  </span>
);
