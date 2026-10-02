/**
 * The Editor's look (DESIGN.md, Editor: code): `code` type with ligatures off,
 * the moonlit syntax tokens (rule/syntax-is-moonlit), line numbers in
 * `text-subtle`, and find/replace on the sunken surface. Every colour is a
 * token, so both themes follow the root's `light-dark()` without a rebuild.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const v = (token: string) => `var(--color-${token})`;

/** Matches are neutral: a find highlight must never read as a signal (rule/colour-means-something). */
const MATCH = `color-mix(in srgb, ${v("text-strong")} 14%, transparent)`;

const MATCH_CURRENT = `color-mix(in srgb, ${v("text-strong")} 26%, transparent)`;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: v("bg"),
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
  ".cm-content": { padding: "8px 0 40vh", caretColor: v("text-strong") },
  ".cm-line": { padding: "0 16px 0 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: `2px solid ${v("text-strong")}` },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: `${v("diff-selection")} !important`,
  },
  ".cm-activeLine": { backgroundColor: v("fill-hover") },
  ".cm-gutters": {
    backgroundColor: v("bg"),
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
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px 6px 20px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "16px",
  },
  ".cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: v("text-subtle"),
  },
  ".cm-search input[type=checkbox]": { accentColor: v("text-default"), margin: 0 },
  ".cm-textfield": {
    height: "24px",
    width: "220px",
    padding: "0 8px",
    margin: 0,
    border: `1px solid ${v("hairline")}`,
    borderRadius: "var(--radius-control)",
    backgroundColor: v("bg"),
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
  ".cm-search button[name=close]": {
    marginLeft: "auto",
    width: "24px",
    height: "24px",
    padding: 0,
    border: "none",
    borderRadius: "var(--radius-control)",
    backgroundColor: "transparent",
    color: v("text-subtle"),
    fontSize: "16px",
    cursor: "pointer",
  },
  ".cm-search button[name=close]:hover": { backgroundColor: v("fill-hover") },
  ".cm-vim-panel": {
    padding: "0 12px",
    minHeight: "24px",
    alignItems: "center",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
  },
  ".cm-vim-panel input": { color: v("text-default"), fontFamily: "var(--font-mono)" },
});

/** DESIGN.md frontmatter: keyword slate, parchment strings and numbers, sage types, strong functions. */
const moonlit = HighlightStyle.define([
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
    color: v("syntax-keyword"),
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.number, t.integer, t.float],
    color: v("syntax-string"),
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.standard(t.tagName), t.annotation],
    color: v("syntax-type"),
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.function(t.propertyName),
      t.macroName,
    ],
    color: v("syntax-function"),
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.processingInstruction],
    color: v("syntax-comment"),
  },
  {
    tag: [t.punctuation, t.operator, t.bracket, t.separator, t.derefOperator, t.angleBracket],
    color: v("syntax-punctuation"),
  },
  { tag: t.heading, color: v("text-strong"), fontWeight: "500" },
  { tag: t.strong, fontWeight: "500" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: v("syntax-keyword"), textDecoration: "underline" },
  { tag: t.invalid, textDecoration: `underline wavy ${v("text-subtle")}` },
]);

export const editorLook: Extension = [editorTheme, syntaxHighlighting(moonlit)];
