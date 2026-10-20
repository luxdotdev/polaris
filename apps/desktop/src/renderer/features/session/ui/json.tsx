/**
 * JSON in a tool's well, coloured by the syntax tokens (rule/syntax-is-moonlit). A tokenizer, not
 * a parser, so a truncated first line or a half-sent result colours the same way.
 */
import { Match } from "effect";

export type JsonTokenKind = "key" | "string" | "literal" | "punctuation" | "plain";

export interface JsonToken {
  readonly kind: JsonTokenKind;
  readonly text: string;
}

/** Past this, the text stays plain: a huge result costs one text node, not a span per token. */
const MAX_HIGHLIGHT = 20_000;

// A string (perhaps unterminated) and the colon after it, a number, a literal, or punctuation.
const TOKEN =
  /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/** Whether text reads as JSON: an object or array, whole or cut short. */
export const looksLikeJson = (text: string): boolean => /^\s*[[{]/.test(text);

/** The text as tokens, in order; their texts join back to it exactly. */
export const jsonTokens = (text: string): ReadonlyArray<JsonToken> => {
  const tokens: Array<JsonToken> = [];
  let at = 0;

  const push = (kind: JsonTokenKind, part: string) => {
    if (part !== "") tokens.push({ kind, text: part });
  };

  for (const match of text.matchAll(TOKEN)) {
    const [whole, string, colon, number, literal] = match;

    push("plain", text.slice(at, match.index));
    at = match.index + whole.length;

    if (string !== undefined) {
      push(colon === undefined ? "string" : "key", string);
      push("punctuation", colon ?? "");
    } else push(number !== undefined || literal !== undefined ? "literal" : "punctuation", whole);
  }

  push("plain", text.slice(at));

  return tokens;
};

const tokenClass = (kind: JsonTokenKind) =>
  Match.value(kind).pipe(
    Match.when("key", () => "text-syntax-keyword"),
    Match.when("string", () => "text-syntax-string"),
    Match.when("literal", () => "text-syntax-type"),
    Match.when("punctuation", () => "text-syntax-punctuation"),
    Match.when("plain", () => undefined),
    Match.exhaustive
  );

/** The text, coloured when it reads as JSON and isn't huge; otherwise as it is. */
export const JsonText = ({ text }: { readonly text: string }) => {
  if (!looksLikeJson(text) || text.length > MAX_HIGHLIGHT) return text;

  return jsonTokens(text).map((token, i) => (
    <span key={i} className={tokenClass(token.kind)} data-json={token.kind}>
      {token.text}
    </span>
  ));
};
