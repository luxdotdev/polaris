import { isKnownHarness, type HarnessKind, type KnownHarnessKind } from "@polaris/protocol";

/** A Harness this build knows (the protocol catalogue); each has one fixed identity hue. */
export type Harness = KnownHarnessKind;

/** An identity hue: a Harness, or Starlight for Polaris's own work. */
export type IdentityHue = Harness | "starlight";

/** Tokens a hue-tinted component can take: identity hues plus the needs-you signal. */
export type TintHue = IdentityHue | "needs-you";

export const HARNESS_NAMES: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** The handle a composer uses to address a Harness ("@claude"). */
export const HARNESS_HANDLES: Record<Harness, string> = {
  claude: "@claude",
  codex: "@codex",
};

const HUE_VARS: Record<TintHue, string> = {
  claude: "var(--color-harness-claude-code)",
  codex: "var(--color-harness-codex)",
  starlight: "var(--color-starlight)",
  "needs-you": "var(--color-needs-you)",
};

export function hueVar(hue: TintHue): string {
  return HUE_VARS[hue];
}

const HARNESS_TEXT_VARS: Record<Harness, string> = {
  claude: "var(--color-harness-claude-code-text)",
  codex: "var(--color-harness-codex-text)",
};

/** A Harness hue set as words: the Working strip, the picker chip (rule/signal-text-variants). */
export function harnessTextVar(harness: Harness): string {
  return HARNESS_TEXT_VARS[harness];
}

const WASH_VARS: Record<TintHue, string> = {
  claude: "var(--wash-claude-code)",
  codex: "var(--wash-codex)",
  starlight: "var(--wash-starlight)",
  "needs-you": "var(--wash-needs-you)",
};

/** The watercolour wash image for a hue, switched per theme in assets.css. */
export function washVar(hue: TintHue): string {
  return WASH_VARS[hue];
}

const HALO_VARS: Record<IdentityHue, string> = {
  claude: "var(--halo-claude-code)",
  codex: "var(--halo-codex)",
  starlight: "var(--halo-starlight)",
};

/** The dither halo image for an identity hue, switched per theme in assets.css. */
export function haloVar(hue: IdentityHue): string {
  return HALO_VARS[hue];
}

/** The identity hue for any Harness kind a Daemon reports; unknown kinds get no hue. */
export function harnessHue(kind: HarnessKind): Harness | "neutral" {
  return isKnownHarness(kind) ? kind : "neutral";
}
