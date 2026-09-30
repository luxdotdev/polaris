import type { HarnessKind } from "@polaris/protocol";

/**
 * A Harness with an identity hue in DESIGN.md. Other catalogue Harnesses (Gemini
 * CLI, GitHub Copilot CLI) get the neutral tile until they have one.
 */
export type Harness = "claude" | "codex";

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

/** Whether a Harness kind has an identity hue; others (and unknown kinds) take the neutral tile. */
export const isHued = (kind: HarnessKind): kind is Harness => Object.hasOwn(HARNESS_NAMES, kind);

/** The identity hue for any Harness kind a Daemon reports; unknown kinds get no hue. */
export function harnessHue(kind: HarnessKind): Harness | "neutral" {
  return isHued(kind) ? kind : "neutral";
}
