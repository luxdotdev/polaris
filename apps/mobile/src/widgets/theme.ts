/**
 * Hands the app's theme to its extensions (DESIGN.md, Mobile chrome redesign · phase 3: themes
 * outside the app): the theme's name in the App Group, read by `targets/widgets/Theme.swift`.
 */
import type { ThemeName } from "../theme/appearance.ts";
import type { WidgetStore } from "./publish.ts";

/** Also `themeKey` in `targets/widgets/Theme.swift`. */
export const THEME_KEY = "polaris.theme";

/** Writes the theme and redraws the widgets only when it differs from what was last written. */
export const themePublisher = (store: WidgetStore): ((theme: ThemeName) => void) => {
  let written: ThemeName | null = null;

  return (theme) => {
    if (theme === written) return;
    store.write(theme);
    written = theme;
    store.reload();
  };
};
