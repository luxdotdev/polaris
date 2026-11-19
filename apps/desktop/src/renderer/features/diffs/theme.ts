/**
 * The theme every Pierre diff is highlighted with: the Editor's highlights theme
 * (features/highlight), whose colours are `--color-syntax-*` tokens (rule/syntax-is-moonlit),
 * so the tokens' `light-dark()` values switch with the app, with no re-highlighting.
 */
import { type DiffsTheme, type HighlighterTypes, registerCustomTheme } from "@pierre/diffs";
import { HIGHLIGHT_THEMES, themeFor } from "../highlight/index.ts";

/** One theme registered twice: Pierre sets the shadow root's colour scheme from a theme's type. */
export const THEMES = { dark: "polaris-moonlit-dark", light: "polaris-moonlit-light" } as const;

/** Diffs highlight with `@pierre/highlights`, in workers and on the main thread alike. */
export const DIFF_HIGHLIGHTER: HighlighterTypes = "highlights";

/** Pierre writes `--diffs-bg` from `bg`, so `bg` names a Polaris token, never `--diffs-bg`. */
export const moonlitTheme = (type: "dark" | "light"): DiffsTheme => ({
  name: THEMES[type],
  type,
  fg: "var(--color-text-default)",
  bg: "var(--polaris-diff-bg)",
  colors: {
    "editor.foreground": "var(--color-text-default)",
    "editor.background": "var(--polaris-diff-bg)",
  },
  zed: { ...HIGHLIGHT_THEMES[themeFor(type)], name: THEMES[type] },
});

/** Registers both themes with Pierre; diffs name them through `THEMES`. */
export const registerDiffThemes = () => {
  registerCustomTheme(THEMES.dark, () => Promise.resolve(moonlitTheme("dark")), "diffs");
  registerCustomTheme(THEMES.light, () => Promise.resolve(moonlitTheme("light")), "diffs");
};
