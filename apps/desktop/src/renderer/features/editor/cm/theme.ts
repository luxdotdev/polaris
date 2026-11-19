/**
 * The Editor's look (DESIGN.md, Editor: code): `code` type with ligatures off,
 * the moonlit syntax tokens (rule/syntax-is-moonlit), line numbers in
 * `text-subtle`, and find/replace on the sunken surface. Every colour is a
 * token, so both themes follow the root's `light-dark()` without a rebuild.
 */
import { HighlightStyle, syntaxHighlighting, type Language } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { completionTheme } from "./completionLook.ts";
import { diagnosticTheme } from "./diagnosticLook.ts";

const v = (token: string) => `var(--color-${token})`;

const CLOSE_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="black" stroke-width="1.2" stroke-linecap="round"/></svg>'
)}")`;

/** Matches are neutral: a find highlight must never read as a signal (rule/colour-means-something). */
const MATCH = `color-mix(in srgb, ${v("text-strong")} 14%, transparent)`;

const MATCH_CURRENT = `color-mix(in srgb, ${v("text-strong")} 26%, transparent)`;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: v("panel"),
    color: v("text-default"),
    fontSize: "var(--code-size, 13px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0, "liga" 0',
    fontVariantNumeric: "tabular-nums",
    scrollbarWidth: "thin",
    scrollbarColor: `color-mix(in srgb, ${v("text-subtle")} 35%, transparent) transparent`,
  },
  // CodeMirror clips tooltips at the gutter's rounded width; 1px keeps column 0's (completion, hover) in.
  ".cm-content": { padding: "8px 0 40vh 1px", caretColor: v("text-strong") },
  ".cm-line": { padding: "0 16px 0 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: `2px solid ${v("text-strong")}` },
  // Vim's block cursor ships pink, which reads as a signal (rule/colour-means-something): neutral here.
  ".cm-fat-cursor": {
    background: `color-mix(in srgb, ${v("text-strong")} 70%, transparent) !important`,
    color: `${v("bg")} !important`,
  },
  "&:not(.cm-focused) .cm-fat-cursor": {
    background: "none !important",
    outline: `1px solid color-mix(in srgb, ${v("text-strong")} 70%, transparent) !important`,
    color: "transparent !important",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: `${v("diff-selection")} !important`,
  },
  ".cm-activeLine": { backgroundColor: v("fill-hover") },
  ".cm-gutters": {
    backgroundColor: v("panel"),
    color: v("text-subtle"),
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-gutter.cm-gitGutter": { width: "2px", marginRight: "10px" },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 20px 0 0",
    minWidth: "2ch",
    textAlign: "right",
  },
  ".cm-activeLineGutter": { backgroundColor: v("fill-hover"), color: v("text-default") },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: `1px solid color-mix(in srgb, ${v("text-subtle")} 60%, transparent)`,
  },
  ".cm-nonmatchingBracket": { backgroundColor: "transparent" },
  ".cm-searchMatch": { backgroundColor: MATCH, borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: MATCH_CURRENT },
  ".cm-selectionMatch": { backgroundColor: MATCH },
  ".cm-foldPlaceholder": {
    backgroundColor: v("fill-selected"),
    border: "none",
    color: v("text-subtle"),
  },
  ".cm-tooltip": {
    backgroundColor: v("surface-raised"),
    color: v("text-default"),
    border: `1px solid ${v("hairline")}`,
    borderRadius: "var(--radius-control)",
    boxShadow: "var(--shadow-float)",
  },
  ".cm-panels": { backgroundColor: v("surface-sunken"), color: v("text-default") },
  ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${v("hairline")}` },
  ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${v("hairline")}` },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px 6px 20px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "16px",
  },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-panel.cm-search label": {
    fontSize: "12px",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: v("text-subtle"),
  },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: v("text-default"), margin: 0 },
  ".cm-textfield": {
    height: "24px",
    width: "220px",
    padding: "0 8px",
    margin: 0,
    border: `1px solid ${v("hairline")}`,
    borderRadius: "var(--radius-control)",
    backgroundColor: v("panel"),
    color: v("text-default"),
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
  },
  ".cm-textfield:focus-visible": { outline: `2px solid ${v("starlight")}`, outlineOffset: "1px" },
  ".cm-button": {
    height: "24px",
    padding: "0 8px",
    margin: 0,
    border: `1px solid ${v("hairline")}`,
    borderRadius: "var(--radius-control)",
    backgroundImage: "none",
    backgroundColor: "transparent",
    color: v("text-default"),
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    fontWeight: "500",
  },
  ".cm-button:hover": { backgroundColor: v("fill-hover") },
  ".cm-button:focus-visible": { outline: `2px solid ${v("starlight")}`, outlineOffset: "1px" },
  ".cm-panel.cm-search [name=close]": {
    marginLeft: "auto",
    width: "24px",
    height: "24px",
    padding: 0,
    border: "none",
    borderRadius: "var(--radius-control)",
    backgroundColor: "transparent",
    color: "transparent",
    fontSize: "0",
    cursor: "pointer",
    position: "relative",
  },
  // The tabs' 12px close mark, not the panel's "×" glyph.
  ".cm-panel.cm-search [name=close]::before": {
    content: '""',
    position: "absolute",
    inset: "6px",
    backgroundColor: v("text-subtle"),
    maskImage: CLOSE_MASK,
    maskSize: "12px 12px",
  },
  ".cm-panel.cm-search [name=close]:hover": { backgroundColor: v("fill-hover") },
  ".cm-vim-panel": {
    padding: "0 12px",
    minHeight: "24px",
    alignItems: "center",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
  },
  ".cm-vim-panel input": { color: v("text-default"), fontFamily: "var(--font-mono)" },
});

/**
 * The Editor's syntax colours by role, as `--color-*` token names: the source of truth the
 * Lezer style below and the highlights theme (features/highlight) both read.
 */
export const SYNTAX = {
  keyword: "syntax-keyword",
  string: "syntax-string",
  type: "syntax-type",
  function: "syntax-function",
  comment: "syntax-comment",
  punctuation: "syntax-punctuation",
  text: "text-default",
  strong: "text-strong",
  quote: "text-subtle",
  mark: "text-faint",
} as const;

/** Markdown's weights: hierarchy by weight and style, never a new hue (DESIGN.md, Editor: Code). */
export const MARKUP_WEIGHT = { heading: 500, heading1: 700, heading2: 600, strong: 600 } as const;

const colour = (role: keyof typeof SYNTAX) => v(SYNTAX[role]);

/** DESIGN.md frontmatter: keyword slate, parchment strings and numbers, sage types, strong functions. */
export const moonlit = HighlightStyle.define([
  // First, so a fence's own grammar colours its tokens over the fence's code tone.
  { tag: t.monospace, color: colour("string") },
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
      t.self,
      t.null,
      t.bool,
      t.tagName,
    ],
    color: colour("keyword"),
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.number, t.integer, t.float],
    color: colour("string"),
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.standard(t.tagName), t.annotation],
    color: colour("type"),
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.function(t.propertyName),
      t.macroName,
    ],
    color: colour("function"),
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta],
    color: colour("comment"),
  },
  {
    tag: [t.punctuation, t.operator, t.bracket, t.separator, t.derefOperator, t.angleBracket],
    color: colour("punctuation"),
  },
  { tag: t.invalid, textDecoration: `underline wavy ${v("text-subtle")}` },
  // Markdown (DESIGN.md, Editor: Code): hierarchy by weight and style, never a new hue.
  { tag: t.heading, color: colour("strong"), fontWeight: `${MARKUP_WEIGHT.heading}` },
  { tag: t.heading1, color: colour("strong"), fontWeight: `${MARKUP_WEIGHT.heading1}` },
  { tag: t.heading2, color: colour("strong"), fontWeight: `${MARKUP_WEIGHT.heading2}` },
  { tag: t.strong, color: colour("strong"), fontWeight: `${MARKUP_WEIGHT.strong}` },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.quote, color: colour("quote"), fontStyle: "italic" },
  { tag: t.link, color: colour("type"), textDecoration: "underline" },
  { tag: t.url, color: colour("string"), textDecoration: "none" },
  // Last, so a mark inside a heading, link or quote stays quiet: `#`, `**`, `>`, `-`, fences, `---`.
  {
    tag: [t.processingInstruction, t.contentSeparator],
    color: colour("mark"),
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
  },
]);

/** Scoped to Markdown's own tree: `labelName` is a fence's info string here, a goto label elsewhere. */
export const moonlitMarkdown = (language: Language) =>
  syntaxHighlighting(
    HighlightStyle.define([{ tag: t.labelName, color: colour("keyword") }], { scope: language })
  );

export const editorLook: Extension = [
  editorTheme,
  diagnosticTheme,
  completionTheme,
  syntaxHighlighting(moonlit),
];
