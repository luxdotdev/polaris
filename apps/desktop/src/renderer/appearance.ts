/** The user's appearance on the root: `data-theme` (unset follows the system) and `data-density`. */
import type { Appearance } from "../shared/api.ts";

export const applyAppearance = (
  { theme, density }: Appearance,
  root = document.documentElement
) => {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  root.dataset.density = density;
};
