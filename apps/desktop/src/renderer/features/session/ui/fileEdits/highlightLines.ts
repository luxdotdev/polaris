/**
 * Patch lines highlighted in the Editor's colours (features/highlight), as runs of text and
 * colour per line. Kept per text, so a row the virtualized list mounts again isn't tokenized again.
 */
import { codeToTokens, type ThemedToken } from "@pierre/highlights";
import {
  HIGHLIGHT_THEMES,
  type HighlightTheme,
  highlightLanguage,
} from "../../../highlight/index.ts";

/** One run of a line: its text, and its colour (`var(--color-syntax-…)`) when it has one. */
export interface Run {
  readonly text: string;
  readonly color: string | null;
}

export type Runs = ReadonlyArray<Run>;

const CACHED = 256;

const cache = new Map<string, ReadonlyArray<Runs>>();

const runsOf = (tokens: ReadonlyArray<ThemedToken>): Runs =>
  tokens.map((token) => ({ text: token.content, color: token.color ?? null }));

/** The language a path's name says: its extension, or the whole name (`Dockerfile`). */
export const languageOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1) : name;
};

const highlight = (lines: ReadonlyArray<string>, lang: string, theme: HighlightTheme) => {
  const { tokens } = codeToTokens(lines.join("\n"), {
    lang: highlightLanguage(lang),
    theme: HIGHLIGHT_THEMES[theme],
  });

  return lines.map((line, at) => {
    const runs = runsOf(tokens[at] ?? []);

    // Highlights drops nothing it lexes; a short answer falls back to the plain line.
    return runs.map((run) => run.text).join("") === line ? runs : [{ text: line, color: null }];
  });
};

/** `lines` as runs, highlighted as one block in `path`'s language. */
export const highlightLines = (
  lines: ReadonlyArray<string>,
  path: string,
  theme: HighlightTheme
): ReadonlyArray<Runs> => {
  const lang = languageOf(path);
  const key = `${theme}\0${lang}\0${lines.join("\n")}`;
  const hit = cache.get(key);

  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);

    return hit;
  }

  const html = highlight(lines, lang, theme);

  cache.set(key, html);

  if (cache.size > CACHED) cache.delete(cache.keys().next().value ?? key);

  return html;
};
