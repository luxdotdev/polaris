import {
  GIT_STATUSES,
  GIT_TINTS,
  GitStatusLetter,
  HarnessMark,
  PixelHandIcon,
  PixelPolarisIcon,
  SESSION_STATES,
  SEVERITIES,
  STATE_LABELS,
  SeverityBadge,
  SeverityGlyph,
  StateIcon,
  Tile,
  type TileSize,
} from "../../src";
import { Section, Swatch } from "./layout";

const TILE_SIZES: readonly TileSize[] = [24, 32, 40];

export function IdentitySection() {
  return (
    <Section title="Tiles and harness marks">
      <div className="flex flex-wrap items-end gap-4">
        {TILE_SIZES.map((size) => (
          <Swatch key={`claude-${size}`} label={`claude ${size}`}>
            <HarnessMark harness="claude" size={size} />
          </Swatch>
        ))}
        {TILE_SIZES.map((size) => (
          <Swatch key={`codex-${size}`} label={`codex ${size}`}>
            <HarnessMark harness="codex" size={size} />
          </Swatch>
        ))}
        {TILE_SIZES.map((size) => (
          <Swatch key={`opencode-${size}`} label={`opencode ${size}`}>
            <HarnessMark harness="opencode" size={size} />
          </Swatch>
        ))}
        <Swatch label="starlight 32">
          <Tile hue="starlight" size={32}>
            <PixelPolarisIcon className="text-starlight" />
          </Tile>
        </Swatch>
        <Swatch label="needs-you 32">
          <Tile hue="needs-you" size={32}>
            <PixelHandIcon className="text-needs-you" />
          </Tile>
        </Swatch>
        <Swatch label="neutral 32">
          <Tile hue="neutral" size={32} />
        </Swatch>
        <Swatch label="dormant 28">
          <HarnessMark harness="claude" size={28} state="dormant" />
        </Swatch>
      </div>
      <div className="flex items-center gap-6">
        <HarnessMark harness="claude" named />
        <HarnessMark harness="codex" named />
        <HarnessMark harness="opencode" named />
        <HarnessMark harness="opencode" named state="working" />
        <HarnessMark harness="claude" named state="working" />
      </div>
    </Section>
  );
}

export function SignalSection() {
  return (
    <Section title="Session states (glyphs, never labels) and severities (badges, always labelled)">
      <div className="grid grid-cols-8 gap-2">
        {SESSION_STATES.map((state) => (
          <Swatch key={state} label={STATE_LABELS[state].toLowerCase()}>
            <div className="flex items-center gap-2">
              <StateIcon state={state} harness="claude" />
              <StateIcon state={state} harness="codex" />
            </div>
            <HarnessMark
              harness={state === "starting" ? "codex" : "claude"}
              size={28}
              state={state}
            />
          </Swatch>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {SEVERITIES.map((severity) => (
          <SeverityBadge key={severity} severity={severity} />
        ))}
        <span className="w-2" />
        {SEVERITIES.map((severity) => (
          <SeverityBadge key={`count-${severity}`} severity={severity} count={1} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-text-faint">under 50% confidence:</span>
        {SEVERITIES.map((severity) => (
          <SeverityBadge key={`low-${severity}`} severity={severity} lowConfidence />
        ))}
        <span className="text-caption text-text-faint">critical never dims</span>
      </div>
      <div className="text-code-inline flex items-center gap-3 font-mono">
        {SEVERITIES.map((severity) => (
          <span key={`glyph-${severity}`} className="text-text-subtle flex items-center gap-1">
            <SeverityGlyph severity={severity} /> 2
          </span>
        ))}
      </div>
      <div className="flex flex-col">
        {GIT_STATUSES.map((status) => (
          <div key={status} className="h-tree-row gap-gap px-row-x flex items-center">
            <span
              className={`text-label flex-1 truncate ${GIT_TINTS[status]} ${status === "deleted" ? "line-through" : ""}`}
            >
              src/{status}.ts
            </span>
            <GitStatusLetter status={status} />
          </div>
        ))}
      </div>
    </Section>
  );
}
