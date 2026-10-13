/**
 * The seam between a language's tokenizer and the diff: a file's text in, its tokens out,
 * with source offsets and a coarse kind. The TypeScript parser is one implementation.
 */

/** Coarse token classes: enough to tell `foo` the name from `"foo"` the string. */
export type TokenKind =
  | "identifier"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "punctuation"
  | "text"
  | "other";

/** A token as `[start, end)` UTF-16 offsets into the file's text. */
export interface SyntaxToken {
  readonly start: number;
  readonly end: number;
  readonly kind: TokenKind;
}

export interface Tokenizer {
  readonly id: string;
  /** Every token of the file in source order, comments included; whitespace is not a token. */
  readonly tokenize: (source: string, path: string) => ReadonlyArray<SyntaxToken>;
}

/** A tokenizer known by the files it handles, loaded only when one is diffed. */
export interface TokenizerSpec {
  readonly id: string;
  readonly supports: (path: string) => boolean;
  readonly load: () => Promise<Tokenizer>;
}
