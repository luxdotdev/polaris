/**
 * The code highlighter behind every Markdown code block: `@pierre/highlights` in the Editor's
 * colours (features/highlight). Loaded on first need as its own chunk (`plugins.ts`). Spans are
 * coloured by tokens that follow the app's appearance, so one theme serves Moonlit and Light.
 */
import { codeToTokens } from "@pierre/highlights";
import {
  CodeStream,
  HIGHLIGHT_THEMES,
  highlightLanguage,
  lineToHtml,
} from "../../../../highlight/index.ts";

export interface CodeHighlighter {
  /** A finished block's lines as escaped HTML, one entry per line. */
  readonly lines: (code: string, language: string) => ReadonlyArray<string>;
  /** A highlighter for a block that's still streaming. */
  readonly stream: (language: string) => CodeStream;
}

const MAX_CACHED = 256;

const THEME = "moonlit";

/** Finished blocks by language and code; the oldest goes first. */
const finished = new Map<string, ReadonlyArray<string>>();

const lines = (code: string, language: string): ReadonlyArray<string> => {
  const lang = highlightLanguage(language);
  const key = `${lang}\n${code}`;
  const cached = finished.get(key);

  if (cached !== undefined) return cached;

  const html = codeToTokens(code, { lang, theme: HIGHLIGHT_THEMES[THEME] }).tokens.map(lineToHtml);

  finished.set(key, html);

  if (finished.size > MAX_CACHED) finished.delete(finished.keys().next().value ?? key);

  return html;
};

export const codeHighlighter: CodeHighlighter = {
  lines,
  stream: (language) => new CodeStream(language, THEME),
};
