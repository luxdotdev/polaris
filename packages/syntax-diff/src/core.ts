/**
 * The diff without a tokenizer: line alignment, token emphasis and patches. A Client that can't
 * ship TypeScript's parser (the Mobile App on Hermes) brings its own tokens through this entry.
 */
export { type Row, type RowKind, type Span, alignLines } from "./align.ts";

export { type LineToken, splitLines, type TokenLine, tokenLines } from "./lines.ts";

export { type EditOp, myers, TooComplex } from "./myers.ts";

export { type Emphasis, type SyntaxPatch, toPatch } from "./patch.ts";

export type { SyntaxToken, Tokenizer, TokenKind } from "./tokens.ts";
