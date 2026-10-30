/**
 * The frame's theme vocabulary (DESIGN.md, Visualizations → the kit, Paper V9): what a
 * Visualization styles against as `var(--pv-*)`, where each comes from in the app, and the values.
 */

export const FRAME_TOKEN_NAMES = [
  "--pv-bg",
  "--pv-surface",
  "--pv-raised",
  "--pv-border",
  "--pv-border-strong",
  "--pv-track",
  "--pv-text-strong",
  "--pv-text",
  "--pv-text-subtle",
  "--pv-text-faint",
  "--pv-accent",
  "--pv-focus",
  "--pv-series-1",
  "--pv-series-2",
  "--pv-series-3",
  "--pv-series-4",
  "--pv-series-5",
  "--pv-font",
  "--pv-font-mono",
  "--pv-radius",
  "--pv-radius-sm",
  "--pv-gap",
  "--pv-pad",
] as const;

export type FrameTokenName = (typeof FRAME_TOKEN_NAMES)[number];

/**
 * The `@polaris/ui` custom property (tokens.css) each frame token is read from; `undefined` where
 * V9 has no single app token (the stronger hairline, the track, the frame's own fonts and sizes).
 */
export const FRAME_TOKEN_SOURCES: Readonly<Record<FrameTokenName, string | undefined>> = {
  "--pv-bg": "--color-panel",
  "--pv-surface": "--color-well",
  "--pv-raised": "--color-raised",
  "--pv-border": "--color-hairline",
  "--pv-border-strong": undefined,
  "--pv-track": undefined,
  "--pv-text-strong": "--color-text-strong",
  "--pv-text": "--color-text-default",
  "--pv-text-subtle": "--color-text-subtle",
  "--pv-text-faint": "--color-text-faint",
  "--pv-accent": "--color-context-tools",
  "--pv-focus": "--color-starlight",
  "--pv-series-1": "--color-context-tools",
  "--pv-series-2": "--color-context-system",
  "--pv-series-3": "--color-context-mcp",
  "--pv-series-4": "--color-context-skills",
  "--pv-series-5": "--color-context-memory",
  "--pv-font": undefined,
  "--pv-font-mono": undefined,
  "--pv-radius": undefined,
  "--pv-radius-sm": undefined,
  "--pv-gap": undefined,
  "--pv-pad": undefined,
};

type FrameTheme = Readonly<Record<FrameTokenName, string>>;

const SHARED = {
  "--pv-font": 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  "--pv-font-mono": '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  "--pv-radius": "10px",
  "--pv-radius-sm": "6px",
  "--pv-gap": "8px",
  "--pv-pad": "16px",
} as const;

const DARK_TEXT = {
  "--pv-text-strong": "#f4f5f7",
  "--pv-text": "#e3e4e8",
  "--pv-text-subtle": "#9a9ca4",
  "--pv-text-faint": "#686a72",
  "--pv-accent": "#7fb2e5",
  "--pv-focus": "#bcd3ff",
  "--pv-series-1": "#7fb2e5",
  "--pv-series-2": "#c3a6e6",
  "--pv-series-3": "#5cbdb9",
  "--pv-series-4": "#e39ac0",
  "--pv-series-5": "#a9c27c",
} as const;

/** Every token in each app theme, from V9's table: Moonlit (dark), Midnight and light. */
export const FRAME_TOKEN_THEMES: Readonly<Record<"moonlit" | "midnight" | "light", FrameTheme>> = {
  moonlit: {
    "--pv-bg": "#1a1b1d",
    "--pv-surface": "#222327",
    "--pv-raised": "#26272b",
    "--pv-border": "#ffffff0f",
    "--pv-border-strong": "#ffffff1a",
    "--pv-track": "#ffffff14",
    ...DARK_TEXT,
    ...SHARED,
  },
  midnight: {
    "--pv-bg": "#0a0b0d",
    "--pv-surface": "#0e0f12",
    "--pv-raised": "#141518",
    "--pv-border": "#ffffff14",
    "--pv-border-strong": "#ffffff24",
    "--pv-track": "#ffffff1a",
    ...DARK_TEXT,
    ...SHARED,
  },
  light: {
    "--pv-bg": "#ffffff",
    "--pv-surface": "#f6f7f9",
    "--pv-raised": "#ffffff",
    "--pv-border": "#00000012",
    "--pv-border-strong": "#0000001f",
    "--pv-track": "#0000000f",
    "--pv-text-strong": "#17181a",
    "--pv-text": "#333438",
    "--pv-text-subtle": "#66686f",
    "--pv-text-faint": "#a4a6ac",
    "--pv-accent": "#3e7ebf",
    "--pv-focus": "#4f82e8",
    "--pv-series-1": "#3e7ebf",
    "--pv-series-2": "#8a67c4",
    "--pv-series-3": "#238f8a",
    "--pv-series-4": "#ba5689",
    "--pv-series-5": "#668833",
    ...SHARED,
  },
};

/** The frame's fallback for each scheme when the Client sends fewer tokens: light, or Moonlit. */
export const FRAME_TOKEN_DEFAULTS: Readonly<Record<"light" | "dark", FrameTheme>> = {
  light: FRAME_TOKEN_THEMES.light,
  dark: FRAME_TOKEN_THEMES.moonlit,
};

export const FRAME_TOKEN_VALUE_MAX = 128;

/** Characters that could close the `:root` rule or the `<style>` element, or start another declaration. */
export const UNSAFE_TOKEN_VALUE = /[<>{};]/;

const TOKEN_NAMES: ReadonlySet<string> = new Set(FRAME_TOKEN_NAMES);

/** A token's value as the frame will use it, or `undefined` when it is dropped. */
export const safeTokenValue = (value: string): string | undefined => {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > FRAME_TOKEN_VALUE_MAX) return undefined;

  return UNSAFE_TOKEN_VALUE.test(trimmed) ? undefined : trimmed;
};

/** Accepts `--pv-bg` or `pv-bg`; anything outside FRAME_TOKEN_NAMES is dropped. */
const tokenName = (name: string): FrameTokenName | undefined => {
  const full = name.startsWith("--") ? name : `--${name}`;

  // SAFETY: TOKEN_NAMES holds exactly FRAME_TOKEN_NAMES.
  return TOKEN_NAMES.has(full) ? (full as FrameTokenName) : undefined;
};

/** The scheme's defaults overlaid with the Client's tokens that pass the filter. */
export const resolveFrameTokens = (
  tokens: Readonly<Record<string, string>>,
  scheme: "light" | "dark"
): FrameTheme => {
  const resolved: Record<FrameTokenName, string> = { ...FRAME_TOKEN_DEFAULTS[scheme] };

  for (const [name, value] of Object.entries(tokens)) {
    const key = tokenName(name);
    const safe = safeTokenValue(value);

    if (key !== undefined && safe !== undefined) resolved[key] = safe;
  }

  return resolved;
};
