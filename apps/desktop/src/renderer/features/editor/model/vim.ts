/** The vim mode indicator (spec §4): NORMAL, INSERT, VISUAL (line, block), REPLACE. */
export type VimMode = "normal" | "insert" | "visual" | "visual line" | "visual block" | "replace";

const MODES: ReadonlyArray<VimMode> = ["normal", "insert", "visual", "replace"];

/** codemirror-vim's `vim-mode-change` event as one of ours; unknown modes read as normal. */
export const modeLabel = (mode: string, subMode?: string): VimMode => {
  if (mode === "visual" && subMode === "linewise") return "visual line";

  if (mode === "visual" && subMode === "blockwise") return "visual block";

  return MODES.find((m) => m === mode) ?? "normal";
};

/** How the status bar spells it: the vim convention, the one place capitals are the label. */
export const modeText = (mode: VimMode) => mode.toUpperCase();
