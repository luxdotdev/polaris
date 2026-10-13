/**
 * Tokens from the real TypeScript parser (TS, TSX, JS, JSX, JSON). Walking the parsed tree,
 * rather than driving the scanner, gets template literals, JSX and regexes right: only
 * the parser knows when a `}` closes a template substitution.
 */
import ts from "typescript-js";
import type { SyntaxToken, Tokenizer, TokenKind } from "./tokens.ts";

const scriptKindFor = (path: string): ts.ScriptKind => {
  if (/\.jsonc?$/i.test(path)) return ts.ScriptKind.JSON;

  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;

  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;

  if (/\.[cm]?js$/i.test(path)) return ts.ScriptKind.JS;

  return ts.ScriptKind.TS;
};

const STRINGS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

const kindOf = (kind: ts.SyntaxKind): TokenKind => {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier)
    return "identifier";

  if (STRINGS.has(kind)) return "string";

  if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral)
    return "number";

  if (kind === ts.SyntaxKind.JsxText) return "text";

  if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) return "keyword";

  if (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation)
    return "punctuation";

  return "other";
};

export const tokenizeTypeScript = (source: string, path: string): Array<SyntaxToken> => {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const tokens: Array<SyntaxToken> = [];
  const seen = new Set<number>();

  const pushComment = (comment: ts.CommentRange) => {
    if (seen.has(comment.pos)) return;
    seen.add(comment.pos);
    tokens.push({ start: comment.pos, end: comment.end, kind: "comment" });
  };

  const visit = (node: ts.Node) => {
    const children = node.getChildren(file);

    if (children.length > 0) {
      for (const child of children) visit(child);

      return;
    }

    // A leaf: the comments on lines before it, the token (not a synthetic empty list), then
    // a comment after it on its own line, which leading ranges never include.
    for (const comment of ts.getLeadingCommentRanges(source, node.pos) ?? []) pushComment(comment);

    if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.kind <= ts.SyntaxKind.LastToken) {
      const start = node.getStart(file);

      if (node.end > start) tokens.push({ start, end: node.end, kind: kindOf(node.kind) });

      for (const comment of ts.getTrailingCommentRanges(source, node.end) ?? [])
        pushComment(comment);
    }
  };

  visit(file);

  return tokens;
};

export const typescriptTokenizer: Tokenizer = { id: "typescript", tokenize: tokenizeTypeScript };
