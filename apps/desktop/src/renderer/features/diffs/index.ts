/**
 * Pierre Diffs on Polaris (DESIGN.md, Diff (Pierre Diffs)): the moonlit theme, the token map
 * under `DIFF_CLASS`, the worker pool, and light or dark as the app shows it. Review and the
 * Editor's diff tabs both render through it.
 */
import "./diff.css";

export { DiffWorkers, type DiffWorkersProps, MAX_LINE_LENGTH, POOL_SIZE } from "./workers.tsx";

export { moonlitTheme, THEMES } from "./theme.ts";

export { useThemeType } from "./useThemeType.ts";

/** The class whose custom properties put Pierre on Polaris tokens; set it on the CodeView. */
export const DIFF_CLASS = "polaris-diff";
