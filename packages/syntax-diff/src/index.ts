/**
 * Syntax-aware diffs: two files are tokenized, lines are matched by their tokens and changed
 * lines are diffed token by token. TypeScript's parser loads on demand (`tokenizerFor`);
 * other languages bring a highlighter's tokens (`tokensFromRuns`, `fixedTokenizer`).
 */
import { alignLines } from "./align.ts";
import { tokenLines } from "./lines.ts";
import { type SyntaxPatch, toPatch } from "./patch.ts";
import type { Tokenizer, TokenizerSpec } from "./tokens.ts";

export { type Row, type RowKind, type Span, alignLines } from "./align.ts";

export { type LineToken, splitLines, type TokenLine, tokenLines } from "./lines.ts";

export { type EditOp, myers, TooComplex } from "./myers.ts";

export { type Emphasis, type SyntaxPatch, toPatch } from "./patch.ts";

export { fixedTokenizer, type TokenRun, tokensFromRuns, tokensFromRunsInSlices } from "./runs.ts";

export type { SyntaxToken, Tokenizer, TokenizerSpec, TokenKind } from "./tokens.ts";

/** TypeScript's parser reads every JavaScript and TypeScript dialect, and JSON. */
const typescript: TokenizerSpec = {
  id: "typescript",
  supports: (path) => /\.(?:[cm]?[jt]sx?|jsonc?)$/i.test(path),
  load: async () => (await import("./typescript.ts")).typescriptTokenizer,
};

export const TOKENIZERS: ReadonlyArray<TokenizerSpec> = [typescript];

export const tokenizerFor = (path: string): TokenizerSpec | null =>
  TOKENIZERS.find((spec) => spec.supports(path)) ?? null;

/** Changed lines past which a file is too different for a token diff (the caller falls back). */
export const MAX_SYNTAX_EDITS = 2000;

export interface SyntaxDiffOptions {
  readonly context?: number;
  readonly maxEdits?: number;
}

/** The syntax-aware patch from `before` to `after`; throws `TooComplex` past `maxEdits`. */
export const syntaxDiff = (
  before: string,
  after: string,
  path: string,
  tokenizer: Tokenizer,
  { context = 3, maxEdits = MAX_SYNTAX_EDITS }: SyntaxDiffOptions = {}
): SyntaxPatch => {
  const oldLines = tokenLines(before, tokenizer.tokenize(before, path));
  const newLines = tokenLines(after, tokenizer.tokenize(after, path));
  const rows = alignLines(oldLines, newLines, maxEdits);

  return toPatch(
    rows,
    { old: oldLines.map((l) => l.text), new: newLines.map((l) => l.text) },
    path,
    context
  );
};
