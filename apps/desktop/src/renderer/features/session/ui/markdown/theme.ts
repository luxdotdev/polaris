/**
 * Markdown's colours from DESIGN.md's tokens (rule/syntax-is-moonlit). Shiki
 * takes CSS variables as token colours, and the tokens switch with the theme
 * through `light-dark()`, so one theme serves both. Mermaid computes shades
 * from real colours, so its shapes take the tokens through `themeCSS` instead.
 */
import type { MermaidOptions, ThemeRegistrationAny } from "streamdown";

type MermaidConfig = NonNullable<MermaidOptions["config"]>;

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

/**
 * The diagram's own CSS: its shapes, lines and labels on the tokens. The SVG
 * is inline, so the variables switch with the theme and it never re-renders.
 */
const MERMAID_CSS = `
  .node rect, .node polygon, .node circle, .node path, .actor, .classGroup rect, .stateGroup rect,
  rect.task, .note {
    fill: ${v("surface-raised")} !important;
    stroke: ${v("text-faint")} !important;
  }
  .cluster rect { fill: ${v("surface-sunken")} !important; stroke: ${v("hairline")} !important; }
  .flowchart-link, .edgePath path, .messageLine0, .messageLine1, .relation, .transition {
    stroke: ${v("text-subtle")} !important;
  }
  marker path, .arrowheadPath, .arrowMarkerPath { fill: ${v("text-subtle")} !important; stroke: none; }
  text, .label, .nodeLabel, .edgeLabel, .messageText, .actor tspan, .cluster-label, span {
    fill: ${v("text-default")} !important;
    color: ${v("text-default")} !important;
  }
  .edgeLabel, .edgeLabel rect, .edgeLabel p, .edgeLabel span, .labelBkg {
    background: ${v("bg")} !important;
    background-color: ${v("bg")} !important;
    fill: ${v("bg")} !important;
  }
  .edgeLabel text, .edgeLabel p, .edgeLabel span { color: ${v("text-subtle")} !important; }
`;

/** Mermaid's `base` theme on the tokens; one config for both themes (`MERMAID_CSS`). */
export const MERMAID_CONFIG: MermaidConfig = {
  theme: "base",
  securityLevel: "strict",
  fontFamily: "inherit",
  themeCSS: MERMAID_CSS,
  themeVariables: { fontSize: "13px", fontFamily: "inherit" },
};
