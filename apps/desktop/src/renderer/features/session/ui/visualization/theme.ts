/**
 * The theme a Visualization frame draws with (DESIGN.md, the kit inside the frame): each
 * `--pv-*` token read from the app's own theme, sent in when the frame loads and again live.
 */
import {
  FRAME_TOKEN_NAMES,
  FRAME_TOKEN_SOURCES,
  FRAME_TOKEN_THEMES,
  type FrameTokens,
} from "@polaris/visualization";

export interface FrameTheme {
  readonly tokens: FrameTokens;
  readonly scheme: "light" | "dark";
}

type Palette = keyof typeof FRAME_TOKEN_THEMES;

const paletteOf = (root: HTMLElement, scheme: FrameTheme["scheme"]): Palette => {
  if (scheme === "light") return "light";

  return root.dataset.theme === "midnight" || root.dataset.themeDark === "midnight"
    ? "midnight"
    : "moonlit";
};

/**
 * Reads the theme from `root`: a colour token resolves through a probe's computed colour, so
 * `light-dark()` and `var()` arrive as plain values; the rest come from V9's table.
 */
export const readFrameTheme = (root: HTMLElement = document.documentElement): FrameTheme => {
  const scheme = getComputedStyle(root).colorScheme.includes("light") ? "light" : "dark";
  const fallback = FRAME_TOKEN_THEMES[paletteOf(root, scheme)];
  const probe = document.createElement("span");

  probe.style.display = "none";
  root.append(probe);

  const tokens = Object.fromEntries(
    FRAME_TOKEN_NAMES.map((name) => {
      const source = FRAME_TOKEN_SOURCES[name];

      if (source === undefined) return [name, fallback[name]];
      probe.style.color = `var(${source})`;
      const value = getComputedStyle(probe).color;

      return [name, value === "" ? fallback[name] : value];
    })
  );

  probe.remove();

  return { tokens, scheme };
};

type Listener = (theme: FrameTheme) => void;

const listeners = new Set<Listener>();

let current: FrameTheme | null = null;

let watching = false;

const refresh = () => {
  current = readFrameTheme();

  for (const listener of listeners) listener(current);
};

/** The theme now, read once and kept until it changes. */
export const frameTheme = (): FrameTheme => {
  current ??= readFrameTheme();

  return current;
};

/** Calls `listener` whenever the app's theme or the system appearance changes. */
export const onFrameTheme = (listener: Listener): (() => void) => {
  listeners.add(listener);

  if (!watching) {
    watching = true;
    new MutationObserver(refresh).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-dark", "class", "style"],
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  }

  return () => listeners.delete(listener);
};
