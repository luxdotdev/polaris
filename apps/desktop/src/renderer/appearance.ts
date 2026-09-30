/**
 * The user's appearance on the root: `data-theme` (unset follows the system), `data-density`,
 * `data-text-size`, `data-diff-palette`, `data-reduce-motion` (unset follows the system), and the code
 * face and size.
 */
import type { Appearance, CodeFont } from "../shared/api.ts";

/** `--font-mono` for each code face; null keeps the token's own (SF Mono). */
const CODE_FONTS: Readonly<Record<CodeFont, string | null>> = {
  "sf-mono": null,
  menlo: 'Menlo, ui-monospace, "SF Mono", monospace',
};

const setOrClear = (root: HTMLElement, key: string, value: string | null) => {
  if (value === null) delete root.dataset[key];
  else root.dataset[key] = value;
};

export const applyAppearance = (appearance: Appearance, root = document.documentElement) => {
  setOrClear(root, "theme", appearance.theme === "system" ? null : appearance.theme);
  root.dataset.density = appearance.density;
  setOrClear(root, "textSize", appearance.textSize === "default" ? null : appearance.textSize);
  setOrClear(root, "diffPalette", appearance.diffPalette === "cvd" ? "cvd" : null);
  setOrClear(
    root,
    "reduceMotion",
    appearance.motion === "system" ? null : String(appearance.motion === "reduce")
  );

  const font = CODE_FONTS[appearance.codeFont];

  if (font === null) root.style.removeProperty("--font-mono");
  else root.style.setProperty("--font-mono", font);

  root.style.setProperty("--code-size", `${appearance.codeFontSize}px`);
};
