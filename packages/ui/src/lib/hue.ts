import { harnessEntry, type HarnessKind, type HarnessSetup } from "@polaris/protocol";

/**
 * A Harness, as the protocol names it: any kind, so a Harness added to the catalogue (or one
 * only a newer Daemon knows) renders without code changes here. Unknown kinds are neutral.
 */
export type Harness = HarnessKind;

/**
 * An identity hue: a Harness kind, or "starlight" for Polaris's own work. Kinds are open
 * strings, so this is a string too; `resolveTint` makes an unknown kind neutral.
 */
export type IdentityHue = string;

/** A tint: an identity hue, "needs-you", or (on tiles) "neutral" for no hue. */
export type TintHue = string;

/** Everything the UI shows about a Harness, from the catalogue (`harnessHue`). */
export interface HarnessIdentity {
  readonly kind: HarnessKind;
  /** The product name ("Claude Code"); an unknown kind shows its kind. */
  readonly name: string;
  /** How a composer addresses it ("@claude"). */
  readonly handle: string;
  /** The token slug for its hue, wash and halo ("claude-code"); null for an unknown kind. */
  readonly hue: string | null;
  /** How to set it up where it isn't installed or signed in; null for an unknown kind. */
  readonly setup: HarnessSetup | null;
}

/** "Claude Code" → "claude-code", "OpenCode" → "opencode": the token names in tokens.css. */
export function hueSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The identity of any Harness kind a Daemon reports, looked up in the catalogue. */
export function harnessHue(kind: HarnessKind): HarnessIdentity {
  const entry = harnessEntry(kind);

  return {
    kind,
    name: entry?.name ?? kind,
    handle: `@${kind}`,
    hue: entry === undefined ? null : hueSlug(entry.name),
    setup: entry?.setup ?? null,
  };
}

const SIGNAL_VARS: Record<"starlight" | "needs-you", string> = {
  starlight: "var(--color-starlight)",
  "needs-you": "var(--color-needs-you)",
};

function signal(hue: TintHue): hue is "starlight" | "needs-you" {
  return hue === "starlight" || hue === "needs-you";
}

/** Resolves a tint to the hue a surface shows: an unknown Harness becomes neutral. */
export function resolveTint(hue: TintHue): TintHue {
  if (hue === "neutral" || signal(hue)) return hue;

  return harnessHue(hue).hue === null ? "neutral" : hue;
}

export function hueVar(hue: TintHue): string {
  if (signal(hue)) return SIGNAL_VARS[hue];

  const slug = harnessHue(hue).hue;

  return slug === null ? "var(--color-text-subtle)" : `var(--color-harness-${slug})`;
}

/**
 * A Harness hue set as words: the Working strip, the picker chip (rule/signal-text-variants).
 * A Harness without a -text token yet falls back to its hue.
 */
export function harnessTextVar(harness: Harness): string {
  const slug = harnessHue(harness).hue;

  return slug === null
    ? "var(--color-text-default)"
    : `var(--color-harness-${slug}-text, var(--color-harness-${slug}))`;
}

const SIGNAL_WASHES: Record<"starlight" | "needs-you", string> = {
  starlight: "var(--wash-starlight)",
  "needs-you": "var(--wash-needs-you)",
};

/** The watercolour wash image for a hue, switched per theme in assets.css; none if missing. */
export function washVar(hue: TintHue): string {
  if (signal(hue)) return SIGNAL_WASHES[hue];

  const slug = harnessHue(hue).hue;

  return slug === null ? "none" : `var(--wash-${slug}, none)`;
}

/** The dither halo image for an identity hue, switched per theme in assets.css; none if missing. */
export function haloVar(hue: IdentityHue): string {
  if (hue === "starlight") return "var(--halo-starlight)";

  const slug = harnessHue(hue).hue;

  return slug === null ? "none" : `var(--halo-${slug}, none)`;
}
