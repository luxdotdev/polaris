/**
 * The completion menu's look (DESIGN.md, Editor: Completion; Paper 18–18d): `fill-selected`
 * rows in the code font, matched characters strong, a kind icon, the server as a footnote.
 */
import { EditorView } from "@codemirror/view";

const v = (token: string) => `var(--color-${token})`;

const mask = (paths: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="black" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  )}")`;

/** Methods and functions: a cube. Properties and values: two lines. Types: braces. Words: a line. */
const ICONS = {
  member: mask('<path d="M6 1.5 10.5 4v4L6 10.5 1.5 8V4L6 1.5ZM1.5 4 6 6.5 10.5 4M6 6.5v4"/>'),
  value: mask('<path d="M2 4h8M2 8h5" stroke-width="1.3"/>'),
  type: mask(
    '<path d="M4.5 2C3 2 3 3 3 4.5S2 6 2 6s1 0 1 1.5S3 10 4.5 10M7.5 2C9 2 9 3 9 4.5S10 6 10 6s-1 0-1 1.5S9 10 7.5 10"/>'
  ),
  word: mask('<path d="M2 6h8" stroke-width="1.3"/>'),
} as const;

const icon = (image: string) => ({ maskImage: image, WebkitMaskImage: image });

export const completionTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": { display: "flex", flexDirection: "column" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    fontVariantLigatures: "none",
    minWidth: "220px",
    maxWidth: "min(480px, 95vw)",
    maxHeight: "240px",
    padding: "4px",
    scrollbarWidth: "thin",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "24px",
    padding: "0 8px",
    lineHeight: "20px",
    borderRadius: "4px",
    color: v("text-default"),
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: v("fill-selected"),
    color: v("text-strong"),
  },
  ".cm-tooltip-autocomplete-disabled > ul > li[aria-selected]": {
    backgroundColor: v("fill-hover"),
  },
  ".cm-completionLabel": { overflow: "hidden", textOverflow: "ellipsis" },
  // Once there is a query, the rest of a label recedes so the match reads first (Paper 18).
  ".cm-tooltip-autocomplete li:not([aria-selected]) .cm-completionLabel:has(.cm-completionMatchedText)":
    { color: v("text-subtle") },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: v("text-strong"),
    fontWeight: "500",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "12px",
    fontStyle: "normal",
    color: v("text-faint"),
    fontSize: "12px",
    whiteSpace: "nowrap",
  },
  ".cm-completionIcon": {
    flexShrink: "0",
    width: "16px",
    height: "16px",
    padding: "0",
    opacity: "1",
    backgroundColor: v("text-faint"),
    maskRepeat: "no-repeat",
    maskPosition: "center",
    maskSize: "12px",
    ...icon(ICONS.word),
  },
  ".cm-completionIcon::after": { content: "none" },
  "li[aria-selected] .cm-completionIcon": { backgroundColor: v("text-subtle") },
  ".cm-completionIcon-method, .cm-completionIcon-function": icon(ICONS.member),
  ".cm-completionIcon-property, .cm-completionIcon-variable, .cm-completionIcon-constant": icon(
    ICONS.value
  ),
  ".cm-completionIcon-class, .cm-completionIcon-interface, .cm-completionIcon-type, .cm-completionIcon-enum, .cm-completionIcon-namespace":
    icon(ICONS.type),
  ".cm-completionFootnote": {
    order: "1",
    flexShrink: "0",
    height: "24px",
    lineHeight: "24px",
    padding: "0 12px",
    borderTop: `1px solid ${v("hairline")}`,
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-micro, 11px)",
    color: v("text-faint"),
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // The info panel holds the shared docs renderer (`lsp/docs.tsx`), which pads itself.
  ".cm-tooltip.cm-completionInfo": {
    padding: "0",
    maxWidth: "none",
    whiteSpace: "normal",
    fontFamily: "var(--font-sans)",
  },
  ".cm-completionInfo.cm-completionInfo-right": { marginLeft: "4px" },
  ".cm-completionInfo.cm-completionInfo-left": { marginRight: "4px" },
});
