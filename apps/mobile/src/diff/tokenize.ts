/**
 * A light tokenizer for any language: words, numbers, strings, comments and single punctuation
 * marks, by one scan. It replaces TypeScript's parser on the phone, which is too large to bundle.
 */
import type { SyntaxToken, TokenKind } from "@polaris/syntax-diff/core";

/** Keywords common to the languages agents edit most; only the kind changes, never the split. */
const KEYWORDS = new Set(
  (
    "as async await break case catch class const continue def default defer delete do elif else " +
    "enum export extends false fn for from func function go if impl import in interface let " +
    "match mut new nil None null package pass private protected pub public raise return self " +
    "static struct super switch this throw true try type typeof undefined use var void while " +
    "with yield"
  ).split(" ")
);

/** Files whose line comments start with `#`; elsewhere `#` is punctuation (`#fff`, `#private`). */
const HASH_COMMENTS =
  /\.(?:py|rb|sh|bash|zsh|ya?ml|toml|r|pl|ex|exs|nix|conf|ini|mk)$|(?:^|\/)(?:Makefile|Dockerfile|\.env[^/]*)$/i;

/** Letters past ASCII, so a word in any script is one token. */
const WIDE = "\\u00C0-\\uFFFF";

const SCAN = new RegExp(
  [
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))`,
    String.raw`(#[^\n]*)`,
    String.raw`("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|\x60(?:[^\x60\\]|\\[\s\S])*\x60?)`,
    String.raw`(\d[\w.]*)`,
    `([A-Za-z_$${WIDE}][\\w$${WIDE}]*)`,
    String.raw`(\S)`,
  ].join("|"),
  "g"
);

const kindOf = (match: RegExpExecArray): TokenKind => {
  if (match[1] !== undefined || match[2] !== undefined) return "comment";

  if (match[3] !== undefined) return "string";

  if (match[4] !== undefined) return "number";

  if (match[5] !== undefined) return KEYWORDS.has(match[5]) ? "keyword" : "identifier";

  return "punctuation";
};

/** Every token of `source` in order; whitespace is not a token. */
export const tokenize = (source: string, path: string): ReadonlyArray<SyntaxToken> => {
  const hash = HASH_COMMENTS.test(path);
  const tokens: Array<SyntaxToken> = [];
  const scan = new RegExp(SCAN.source, SCAN.flags);

  for (let match = scan.exec(source); match !== null; match = scan.exec(source)) {
    // `#` outside a hash-comment language is one mark, and the scan goes on after it.
    if (match[2] !== undefined && !hash) {
      tokens.push({ start: match.index, end: match.index + 1, kind: "punctuation" });
      scan.lastIndex = match.index + 1;
      continue;
    }

    tokens.push({ start: match.index, end: match.index + match[0].length, kind: kindOf(match) });
  }

  return tokens;
};
