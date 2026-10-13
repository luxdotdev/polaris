/**
 * The diff Pierre draws. By line, Pierre diffs the two files itself; syntax-aware, it reads
 * our patch against both full files, so context can still be expanded, and a line that only
 * gained tokens is one context row whose new tokens we mark.
 */
import { type FileDiffMetadata, parseDiffFromFile, processFile } from "@pierre/diffs";
import type { Emphasis } from "@polaris/syntax-diff";
import { basename } from "../../explorer/model/paths.ts";
import type { DiffTarget } from "../model/target.ts";
import type { LineReason, SyntaxResult } from "./syntax.ts";

export interface ComposedDiff {
  readonly diff: FileDiffMetadata;
  readonly emphasis: ReadonlyArray<Emphasis>;
  /** New-side lines (1-based) that only gained tokens: context rows with a change mark. */
  readonly inserted: ReadonlyArray<number>;
  readonly mode: "syntax" | "line";
  /** Syntax-aware found nothing but spacing changed: the line diff shows it instead. */
  readonly spacingOnly: boolean;
  /** Why syntax-aware was asked for but the line diff is shown ("pending": not ready yet). */
  readonly fallback: LineReason | "pending" | null;
}

const names = (target: DiffTarget) => {
  const name = target.repoPath;

  return { old: target.origRepoPath ?? name, new: name };
};

/** FNV-1a: a cache key for the pool's highlights of exactly these contents. */
const hashOf = (text: string) => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);

  return `${(hash >>> 0).toString(36)}.${text.length}`;
};

const lineDiff = (target: DiffTarget, old: string, fresh: string, key: string) => {
  const name = names(target);

  return parseDiffFromFile(
    { name: name.old, contents: old, cacheKey: `${key}:old` },
    { name: name.new, contents: fresh, cacheKey: `${key}:new` }
  );
};

/** The diff of `old` to `fresh` for `target`, syntax-aware when `syntax` produced a patch. */
export const composeDiff = (
  target: DiffTarget,
  old: string,
  fresh: string,
  syntax: SyntaxResult | null
): ComposedDiff => {
  const key = `polaris-diff:${target.side}:${hashOf(old)}:${hashOf(fresh)}`;
  const line = { emphasis: [], inserted: [], mode: "line" as const, fallback: null };

  if (syntax === null)
    return { diff: lineDiff(target, old, fresh, key), ...line, spacingOnly: false };

  if (syntax.kind === "line") {
    const diff = lineDiff(target, old, fresh, key);

    return { diff, ...line, spacingOnly: false, fallback: syntax.reason };
  }

  if (syntax.patch === "")
    return { diff: lineDiff(target, old, fresh, key), ...line, spacingOnly: true };

  const name = names(target);

  const diff = processFile(syntax.patch, {
    cacheKey: `${key}:syntax`,
    oldFile: { name: name.old, contents: old },
    newFile: { name: name.new, contents: fresh },
  });

  if (diff === undefined) {
    const byLine = lineDiff(target, old, fresh, key);

    return { diff: byLine, ...line, spacingOnly: false, fallback: "failed" };
  }

  return {
    diff: name.old === name.new ? diff : { ...diff, prevName: name.old },
    emphasis: syntax.emphasis,
    inserted: syntax.inserted,
    mode: "syntax",
    spacingOnly: false,
    fallback: null,
  };
};

/** The file's name for headers: the base name, a rename's old one first. */
export const displayName = (target: DiffTarget) =>
  target.origRepoPath === null
    ? basename(target.path)
    : `${basename(target.origRepoPath)} → ${basename(target.path)}`;
