import type { HarnessKind } from "@polaris/protocol";

/** A Harness, as the protocol names it; each has one fixed identity hue. */
export type Harness = HarnessKind;

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
