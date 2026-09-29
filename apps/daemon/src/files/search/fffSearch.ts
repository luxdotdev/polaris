/**
 * Path search and grep on one fff `FileFinder`. Runs inside the fff worker
 * (`fffWorker.ts`): every fff call is synchronous FFI, so a grep that reads
 * the whole tree would otherwise block the Daemon's event loop.
 *
 * Regex greps (and case-insensitive ones, which are regexes with `(?i)`) are
 * narrowed first: fff's regex prefilter only uses common bigrams, so a regex
 * like `export const needle\w+ = true` reads every file, while a plain search
 * for its required literal `needle` uses the rare bigrams and is instant.
 * The plain search finds the files containing the literal (every match must
 * contain it), and the regex then runs on those files only, still in fff,
 * restricted with a brace glob of their paths. Results are the same as the
 * full regex grep: same engine, same files in the same order.
 */
import { join } from "node:path";
import type { FileFinder } from "@ff-labs/fff-bun";
import { type RequiredLiteral, requiredLiterals } from "./regexLiterals.ts";
import type { GrepHit, GrepQuery, PathHit } from "./types.ts";

/** Most candidate files narrowed to: fff matches a brace glob against every file, ~0.6 ms per path on 50k files. */
export const MAX_CANDIDATES = 128;

/** Time the literal searches may take in all before narrowing is given up (none is selective). */
const LITERAL_BUDGET_MS = 50;

/** Shortest literal worth a search. */
const MIN_LITERAL = 3;

/** Literals tried, longest first, until one is in few enough files. */
const MAX_LITERAL_TRIES = 4;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);

  return result.value;
};

export const fffSearchPaths = (
  finder: FileFinder,
  root: string,
  query: string,
  limit: number
): Array<PathHit> => {
  const result = unwrap(finder.fileSearch(query, { pageSize: limit }));

  return result.items.map((item, i) => ({
    path: join(root, item.relativePath),
    score: result.scores[i]?.total ?? 0,
  }));
};

/**
 * Whether fff's grep query parser could read `token` as a constraint (a
 * glob, `*.ext`, `/dir/`, `!x`, `type:x`) rather than text. Conservative:
 * a false positive only means no narrowing.
 */
const mayBeConstraint = (token: string): boolean => {
  if (token.startsWith("\\") && token.length > 1) return false;

  if (/^[*!/]/.test(token) || token.endsWith("/")) return true;

  if (/[*?[{]/.test(token) && (token.includes("/") || token.includes("{"))) return true;

  return token.startsWith("type:");
};

/**
 * Paths that can go in a brace glob as-is: no glob syntax, commas or
 * whitespace, ASCII only. Others make the grep read everything.
 */
const globSafe = (path: string) => /^[A-Za-z0-9_./-]+$/.test(path);

/** Matches no file: used to still have fff compile (and so validate) the regex. */
const NO_FILES = ["polaris-no-such-dir/none", "polaris-no-such-dir/nothing"];

type Plan = { readonly glob: string } | { readonly full: true };

/** Required literals worth trying, longest first. */
const candidateLiterals = (query: string): ReadonlyArray<RequiredLiteral> =>
  (requiredLiterals(query) ?? [])
    .filter((l) => Array.from(l.text).length >= MIN_LITERAL)
    .sort((a, b) => Array.from(b.text).length - Array.from(a.text).length)
    .slice(0, MAX_LITERAL_TRIES);

/**
 * Relative paths of the files containing `literal`, or null when there are
 * more than MAX_CANDIDATES or the search ran out of time (not selective).
 */
const filesContaining = (
  finder: FileFinder,
  literal: RequiredLiteral,
  budgetMs: number
): Array<string> | null => {
  const text = literal.caseInsensitive ? literal.text.toLowerCase() : literal.text;

  const found = finder.grep(text, {
    mode: "plain",
    // Smart case on an all-lowercase needle is case-insensitive.
    smartCase: literal.caseInsensitive,
    maxMatchesPerFile: 1,
    pageSize: MAX_CANDIDATES + 1,
    timeBudgetMs: budgetMs,
    enforceTimeBudget: true,
  });

  if (!found.ok || found.value.nextCursor !== null) return null;
  const paths = [...new Set(found.value.items.map((item) => item.relativePath))];

  return paths.length > MAX_CANDIDATES ? null : paths;
};

/**
 * The files a regex grep can be restricted to, as a brace glob, or `full`
 * when it must read everything: no required literal, none selective within
 * the time budget, or a query fff's parser might read differently with a
 * glob in front.
 */
export const narrowRegexGrep = (finder: FileFinder, query: string): Plan => {
  const tokens = query.trim().split(/\s+/);

  if (tokens.some(mayBeConstraint) || /﻿/.test(query)) return { full: true };
  const deadline = performance.now() + LITERAL_BUDGET_MS;

  for (const literal of candidateLiterals(query)) {
    const budget = Math.floor(deadline - performance.now());

    if (budget <= 0) break;
    const paths = filesContaining(finder, literal, budget);

    if (paths === null) continue;

    if (!paths.every(globSafe)) return { full: true };
    // Two entries at least (a brace glob needs a comma), and a letter so
    // fff's parser takes it for a glob.
    const entries = paths.length === 0 ? NO_FILES : [...paths, paths[0]!];

    if (!entries.some((p) => /[A-Za-z]/.test(p))) return { full: true };

    return { glob: `{${entries.join(",")}}` };
  }

  return { full: true };
};

export const fffGrep = (
  finder: FileFinder,
  root: string,
  { pattern, regex, caseSensitive, limit }: GrepQuery,
  options: { readonly narrow?: boolean } = {}
): Array<GrepHit> => {
  if (limit <= 0) return [];
  // fff has no case-insensitive flag, only smart case; force insensitivity with `(?i)`.
  const mode = caseSensitive && !regex ? ("plain" as const) : ("regex" as const);
  const query = caseSensitive ? pattern : `(?i)${regex ? pattern : escapeRegex(pattern)}`;
  const plan = mode === "regex" && options.narrow !== false ? narrowRegexGrep(finder, query) : null;
  const effective = plan !== null && "glob" in plan ? `${plan.glob} ${query}` : query;
  const result = unwrap(finder.grep(effective, { mode, smartCase: false, pageSize: limit }));

  if (result.regexFallbackError !== undefined) throw new Error(result.regexFallbackError);

  return result.items.slice(0, limit).map((match) => ({
    path: join(root, match.relativePath),
    line: match.lineNumber,
    column: match.col + 1,
    text: match.lineContent,
  }));
};
