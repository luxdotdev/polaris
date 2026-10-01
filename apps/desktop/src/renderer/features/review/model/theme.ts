/**
 * The Shiki theme Review's diffs are highlighted with: every colour is a `--color-syntax-*`
 * token (DESIGN.md, rule/syntax-is-moonlit), so one theme serves both appearances and the
 * tokens' `light-dark()` values switch with the app, with no re-highlighting.
 */
import type { ThemeRegistration } from "@pierre/diffs";

/** One theme registered twice: Pierre sets the shadow root's colour scheme from a theme's type. */
export const THEMES = { dark: "polaris-moonlit-dark", light: "polaris-moonlit-light" } as const;

const token = (scope: ReadonlyArray<string>, name: string) => ({
  scope: [...scope],
  settings: { foreground: `var(--color-syntax-${name})` },
});

/** Pierre writes `--diffs-bg` from `bg`, so `bg` names a Polaris token, never `--diffs-bg`. */
export const moonlitTheme = (type: "dark" | "light"): ThemeRegistration => ({
  name: THEMES[type],
  type,
  fg: "var(--color-text-default)",
  bg: "var(--review-diff-bg)",
  colors: {
    "editor.foreground": "var(--color-text-default)",
    "editor.background": "var(--review-diff-bg)",
  },
  tokenColors: [
    token(
      ["keyword", "storage", "storage.type", "storage.modifier", "keyword.operator.new"],
      "keyword"
    ),
    token(
      ["string", "constant.numeric", "constant.language", "constant.character", "string.regexp"],
      "string"
    ),
    token(
      [
        "entity.name.type",
        "support.type",
        "support.class",
        "entity.name.class",
        "entity.other.inherited-class",
        "entity.name.tag",
        "support.class.component",
      ],
      "type"
    ),
    token(
      ["entity.name.function", "support.function", "meta.function-call", "variable.function"],
      "function"
    ),
    token(["comment", "punctuation.definition.comment"], "comment"),
    token(["punctuation", "meta.brace", "keyword.operator"], "punctuation"),
  ],
});
