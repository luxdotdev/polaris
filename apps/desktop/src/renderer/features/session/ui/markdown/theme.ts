/**
 * Code colours from DESIGN.md's tokens (rule/syntax-is-moonlit). Shiki takes CSS variables as
 * token colours, and the tokens switch with the theme through `light-dark()`, so one theme
 * serves both. Diagrams take the tokens through Pele's CSS variables (`markdown.css`).
 */
import type { ThemeRegistrationAny } from "shiki";

const v = (name: string) => `var(--color-${name})`;

const scope = (scopes: ReadonlyArray<string>, token: string) => ({
  scope: [...scopes],
  settings: { foreground: v(token) },
});

export const POLARIS_SHIKI: ThemeRegistrationAny = {
  name: "polaris",
  type: "dark",
  colors: { "editor.foreground": v("text-default"), "editor.background": "transparent" },
  fg: v("text-default"),
  bg: "transparent",
  tokenColors: [
    scope(["comment", "punctuation.definition.comment"], "syntax-comment"),
    scope(["keyword", "storage", "storage.type", "keyword.operator.new"], "syntax-keyword"),
    scope(
      ["string", "constant.numeric", "constant.language", "constant.character", "markup.inline"],
      "syntax-string"
    ),
    scope(
      ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.name.tag"],
      "syntax-type"
    ),
    scope(["entity.name.function", "support.function", "meta.function-call"], "syntax-function"),
    scope(["punctuation", "meta.brace", "keyword.operator"], "syntax-punctuation"),
    scope(["markup.inserted"], "diff-added-text"),
    scope(["markup.deleted"], "diff-removed-text"),
  ],
};
