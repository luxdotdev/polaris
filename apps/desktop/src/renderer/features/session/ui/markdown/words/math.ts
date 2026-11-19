/**
 * Math delimiters for Words (ADR 0115). Words reads `$…$` and `$$…$$`; assistants also write
 * `\(…\)` and `\[…\]`. A lone `$` stays a dollar, as it did under Streamdown, so `$HOME/$USER`
 * never turns into a formula. Only delimiters Words parses as prose text change; code, links,
 * autolinks, raw HTML and attributes stay as written (see `proseTokens`).
 */
import { renderToHtml } from "@pierre/words";

type Kind = "$" | "\\$" | "\\(" | "\\)" | "\\[" | "\\]";

interface Token {
  readonly kind: Kind;
  readonly at: number;
}

/** A backslash escape (any ASCII punctuation) or a dollar; escapes we don't need are skipped. */
const SCAN = /\\[!-/:-@[-`{-~]|\$/g;

const KINDS: ReadonlySet<string> = new Set(["$", "\\$", "\\(", "\\)", "\\[", "\\]"]);

/** Markers are private-use code points, one per token, after an escaped `*`. */
const BASE = 0xf0000;

const decoder = new TextDecoder();

const tokensOf = (text: string): Array<Token> =>
  Array.from(text.matchAll(SCAN), (match) => ({ kind: match[0], at: match.index }))
    // SAFETY: KINDS holds exactly the Kind literals.
    .filter((token): token is Token => KINDS.has(token.kind));

/** A tag (quoted attributes may hold `>`), noting a `code` or `pre`; or a marker in text. */
const HTML_PART =
  /<(\/?)(code|pre)?\b(?:[^>"']|"[^"]*"|'[^']*')*>|(\\?)\*([\u{F0000}-\u{FFFFD}])/gu;

/** The markers Words' HTML shows in prose text: outside tags, code and `pre`, unescaped. */
const proseMarkers = (html: string): Set<number> => {
  const prose = new Set<number>();
  let code = 0;

  for (const [, closing, codeTag, escape, marker] of html.matchAll(HTML_PART)) {
    if (codeTag !== undefined) code += closing === "/" ? -1 : 1;
    else if (marker !== undefined && escape === "" && code === 0)
      prose.add((marker.codePointAt(0) ?? 0) - BASE);
  }

  return prose;
};

/**
 * Which tokens Words reads as prose. Each becomes `\*` and a marker, the text renders as it will
 * (math off); a marker shown as `*` in a text node outside code was parsed, not kept raw.
 */
const proseTokens = (text: string, tokens: ReadonlyArray<Token>, options: MathOptions) => {
  let probe = "";
  let at = 0;

  tokens.forEach((token, index) => {
    probe += `${text.slice(at, token.at)}\\*${String.fromCodePoint(BASE + index)}`;
    at = token.at + token.kind.length;
  });

  const prose = proseMarkers(
    decoder.decode(
      renderToHtml(probe + text.slice(at), {
        skipHtml: !options.html,
        math: false,
        incomplete: options.incomplete,
      })
    )
  );

  return tokens.filter((_, index) => prose.has(index));
};

export interface MathOptions {
  /** As the text will render: unfinished syntax completed (a streaming message). */
  readonly incomplete: boolean;
  /** As the text will render: raw HTML kept. */
  readonly html: boolean;
}

interface Edit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

const BLANK_LINE = /\n[ \t]*\n/;

/** `\(…\)` as `$…$` (trimmed) and `\[…\]` as `$$…$$`, within one block; null when unclosed. */
const bracketed = (text: string, open: Token, close: Token | undefined): Array<Edit> | null => {
  if (close === undefined) return null;
  const inner = text.slice(open.at + 2, close.at);

  if (inner.trim() === "" || BLANK_LINE.test(inner)) return null;

  if (open.kind === "\\[")
    return [
      { from: open.at, to: open.at + 2, text: "$$" },
      { from: close.at, to: close.at + 2, text: "$$" },
    ];
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;

  return [
    { from: open.at, to: open.at + 2 + lead, text: "$" },
    { from: close.at - trail, to: close.at + 2, text: "$" },
  ];
};

const isPair = (tokens: ReadonlyArray<Token>, index: number) =>
  tokens[index]?.kind === "$" &&
  tokens[index + 1]?.kind === "$" &&
  tokens[index + 1]?.at === (tokens[index]?.at ?? 0) + 1;

/** After a `$$` at `index`: the index past its closing `$$`, or the end when it's still open. */
const pastDisplay = (tokens: ReadonlyArray<Token>, index: number): number => {
  for (let next = index + 2; next < tokens.length; next += 1)
    if (isPair(tokens, next)) return next + 2;

  return tokens.length;
};

const editsFor = (text: string, tokens: ReadonlyArray<Token>): Array<Edit> => {
  const edits: Array<Edit> = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token === undefined) break;

    if (isPair(tokens, index)) {
      index = pastDisplay(tokens, index);
      continue;
    }

    if (token.kind === "$") edits.push({ from: token.at, to: token.at + 1, text: "\\$" });

    if (token.kind === "\\(" || token.kind === "\\[") {
      const closer = token.kind === "\\(" ? "\\)" : "\\]";
      const end = tokens.findIndex((other, at) => at > index && other.kind === closer);
      const pair = bracketed(text, token, tokens[end]);

      if (pair !== null) {
        edits.push(...pair);
        index = end + 1;
        continue;
      }
    }

    index += 1;
  }

  return edits;
};

/** The text with `\(…\)` and `\[…\]` as Words' math, and lone `$` escaped, in prose only. */
export const normalizeMath = (text: string, options: MathOptions): string => {
  const tokens = tokensOf(text);

  if (tokens.length === 0) return text;
  let out = "";
  let at = 0;

  for (const edit of editsFor(text, proseTokens(text, tokens, options))) {
    out += text.slice(at, edit.from) + edit.text;
    at = edit.to;
  }

  return out + text.slice(at);
};
