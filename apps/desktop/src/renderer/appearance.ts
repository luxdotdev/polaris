/**
 * The user's appearance on the root: `data-platform` (the Client's OS), `data-theme` (unset follows the system),
 * `data-theme-dark` (Moonlit or Midnight), `data-density`,
 * `data-text-size`, `data-diff-palette`, `data-reduce-motion` (unset follows the system), and the code
 * face and size.
 */
import type { Appearance, CodeFont } from "../shared/api.ts";
import { clientPlatform, isWindows } from "../shared/platform.ts";

/** `--font-mono` for each code face; null keeps the token's own (SF Mono, or Cascadia Mono). */
const CODE_FONTS: Readonly<Record<CodeFont, string | null>> = {
  "sf-mono": null,
  menlo: isWindows()
    ? 'Consolas, "Cascadia Mono", monospace'
    : 'Menlo, ui-monospace, "SF Mono", monospace',
};

const setOrClear = (root: AppearanceRoot, key: string, value: string | null) => {
  if (value === null) delete root.dataset[key];
  else root.dataset[key] = value;
};

/** What applyAppearance writes to: the document's root, or a stand-in. */
export interface AppearanceRoot {
  readonly dataset: DOMStringMap;
  readonly style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
}

export const applyAppearance = (
  appearance: Appearance,
  root: AppearanceRoot = document.documentElement
) => {
  root.dataset.platform = clientPlatform();
  setOrClear(root, "theme", appearance.theme === "system" ? null : appearance.theme);
  root.dataset.themeDark = appearance.darkTheme;
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
