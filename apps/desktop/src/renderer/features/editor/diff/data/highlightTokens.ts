/**
 * Tokens for languages the TypeScript parser doesn't read, from the highlighter the diff
 * already runs: the file is highlighted in Pierre's worker pool, with the grammars it loaded
 * to draw diffs, and its spans become tokens. No second Shiki is loaded.
 */
import { type FileContents, getFiletypeFromFileName } from "@pierre/diffs";
import type { useWorkerPool } from "@pierre/diffs/react";
import { type SyntaxToken, tokensFromRunsInSlices } from "@polaris/syntax-diff";
import { type HastNode, runsOfLines } from "../model/highlightRuns.ts";

export type HighlightPool = NonNullable<ReturnType<typeof useWorkerPool>>;

/** Past this many lines a second highlight costs seconds and tens of MB: the line diff stands. */
export const MAX_HIGHLIGHT_LINES = 5_000;

/** The highlighter's language for `path`; null for plain text and unknown files. */
export const highlightLanguage = (path: string): string | null => {
  const language = getFiletypeFromFileName(path);

  return language === "text" || language === "ansi" ? null : language;
};

/** FNV-1a over the text: a cache key for this exact content. */
const contentKey = (text: string) => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);

  return `${(hash >>> 0).toString(36)}.${text.length}`;
};

/** Highlighted lines from the pool's cache, primed for this call and evicted after. */
const highlightedLines = async (pool: HighlightPool, file: FileContents & { cacheKey: string }) => {
  await pool.primeFileHighlightCache(file);
  const cached = pool.getFileResultCache(file);

  // The window keeps only tokens; the highlighted file is the diff's to cache, not ours.
  pool.evictFileFromCache(file.cacheKey);

  return cached?.result.code;
};

/** Lines per slice: about 4 ms on an M-series Mac, so a frame gets through between slices. */
const SLICE = 500;

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The highlighted lines as tokens, a slice at a time on this (the UI) thread. */
const inSlices = async (text: string, lines: ReadonlyArray<HastNode>) => {
  const runs: ReturnType<typeof runsOfLines> = [];

  for (let at = 0; at < lines.length; at += SLICE) {
    runs.push(...runsOfLines(lines.slice(at, at + SLICE)));
    await nextFrame();
  }

  const slices = tokensFromRunsInSlices(text, runs, SLICE);

  for (;;) {
    const step = slices.next();

    if (step.done === true) return step.value;
    await nextFrame();
  }
};

/** A render-options change (the theme) drops a highlight in flight: then it's asked again. */
const ATTEMPTS = 3;

/** `text`'s tokens by highlighting it in the pool; null when it can't be highlighted. */
export const highlightTokens = async (
  pool: HighlightPool,
  path: string,
  text: string
): Promise<ReadonlyArray<SyntaxToken> | null> => {
  if (!pool.isWorkingPool()) return null;

  // A pool still starting answers a prime with nothing; wait for it as its own renders do.
  if (!pool.isInitialized()) await pool.initialize();

  const file = { name: path, contents: text, cacheKey: `polaris-diff-tokens:${contentKey(text)}` };

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const lines: ReadonlyArray<HastNode> | undefined = await highlightedLines(pool, file);

    if (lines !== undefined) return await inSlices(text, lines);
  }

  return null;
};
