/**
 * Syntax highlighting outside the Editor, on `@pierre/highlights` in the Editor's colours:
 * Review diffs (features/diffs), Markdown code and inline edits. See README.md.
 */
export { highlightLanguage, highlightToHtml } from "./html.ts";

export { CodeStream, type CodeStreamState, lineToHtml } from "./stream.ts";

export {
  HIGHLIGHT_THEMES,
  type HighlightTheme,
  type SyntaxRole,
  themeFor,
  TOKEN_PREFIX,
} from "./theme.ts";
