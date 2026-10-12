/**
 * Diagnostics' look (DESIGN.md, Editor: Hover): the hover stays within 560px and a message
 * wraps at a 72ch prose measure, with a 2px severity bar in place of CodeMirror's red block.
 */
import { EditorView } from "@codemirror/view";

const v = (token: string) => `var(--color-${token})`;

/** One hue per severity; info and hint stay neutral. */
export const SEVERITY = {
  error: v("failed"),
  warning: v("severity-medium"),
  info: v("text-subtle"),
  hint: v("text-subtle"),
} as const;

export const diagnosticTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-hover": { maxWidth: "min(560px, calc(100vw - 32px))" },
  ".cm-tooltip-lint": { maxWidth: "72ch", fontFamily: "var(--font-sans)" },
  ".cm-tooltip-lint .cm-diagnostic": {
    maxWidth: "72ch",
    padding: "8px 12px 8px 10px",
    marginLeft: 0,
    fontSize: "var(--text-body)",
    lineHeight: "var(--text-body--line-height)",
    color: v("text-default"),
    overflowWrap: "anywhere",
  },
  ".cm-tooltip-lint .cm-diagnostic + .cm-diagnostic": { borderTop: `1px solid ${v("hairline")}` },
  ".cm-diagnostic-error": { borderLeft: `2px solid ${SEVERITY.error}` },
  ".cm-diagnostic-warning": { borderLeft: `2px solid ${SEVERITY.warning}` },
  ".cm-diagnostic-info": { borderLeft: `2px solid ${SEVERITY.info}` },
  ".cm-diagnostic-hint": { borderLeft: `2px solid ${SEVERITY.hint}` },
  ".cm-diagnosticSource": {
    marginTop: "2px",
    fontSize: "var(--text-caption)",
    lineHeight: "var(--text-caption--line-height)",
    color: v("text-subtle"),
    opacity: 1,
  },
  ".cm-tooltip-section:not(:first-child)": { borderTop: `1px solid ${v("hairline")}` },
});
