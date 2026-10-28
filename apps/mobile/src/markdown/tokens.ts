/**
 * marked's tokens to the Mobile App's Markdown model: inline tokens become flat styled spans,
 * block tokens the blocks `Markdown.tsx` draws. Links keep a target only when the phone may open it.
 */
import type { MarkedToken, Token, Tokens } from "marked";
import type { Align, Block, ListItem, Mark, Span, Spans } from "./model.ts";

const NAMED = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", String.fromCharCode(0xa0)],
  ["mdash", "—"],
  ["ndash", "–"],
  ["hellip", "…"],
  ["rarr", "→"],
  ["larr", "←"],
  ["times", "×"],
  ["copy", "©"],
]);

const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z]+));/g;

const codePoint = (value: number, whole: string) =>
  value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;

/** Character references in prose, as a browser would show them; unknown names stay as written. */
export const decodeEntities = (text: string): string =>
  text.includes("&")
    ? text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
        if (decimal !== undefined) return codePoint(Number.parseInt(decimal, 10), whole);

        if (hex !== undefined) return codePoint(Number.parseInt(hex, 16), whole);

        return NAMED.get(name ?? "") ?? whole;
      })
    : text;

const OPENABLE = /^(?:https?:\/\/|mailto:)/i;

/** A link target the phone opens: web pages and mail only, never app schemes or relative paths. */
export const openableHref = (href: string): string | null => (OPENABLE.test(href) ? href : null);

interface Style {
  readonly marks: ReadonlyArray<Mark>;
  readonly href: string | null;
}

const PLAIN: Style = { marks: [], href: null };

const withMark = (style: Style, mark: Mark): Style =>
  style.marks.includes(mark) ? style : { ...style, marks: [...style.marks, mark] };

const sameStyle = (a: Span, b: Style) =>
  a.href === b.href &&
  a.marks.length === b.marks.length &&
  a.marks.every((m) => b.marks.includes(m));

const push = (out: Array<Span>, text: string, style: Style) => {
  if (text === "") return;

  const last = out.at(-1);

  if (last !== undefined && sameStyle(last, style))
    out[out.length - 1] = { ...last, text: last.text + text };
  else out.push({ text, marks: style.marks, href: style.href });
};

// SAFETY: the lexer runs without extensions, so every token is one of marked's own types.
const known = (token: Token) => token as MarkedToken;

const prose = (text: string) => decodeEntities(text).replaceAll("\n", " ");

const inlineInto = (out: Array<Span>, tokens: ReadonlyArray<Token>, style: Style): void => {
  for (const token of tokens) inlineToken(out, known(token), style);
};

const inlineToken = (out: Array<Span>, token: MarkedToken, style: Style): void => {
  switch (token.type) {
    case "text":
      if (token.tokens === undefined) push(out, prose(token.text), style);
      else inlineInto(out, token.tokens, style);

      return;
    case "escape":
      return push(out, token.text, style);
    case "strong":
    case "em":
    case "del":
      return inlineInto(out, token.tokens, withMark(style, token.type));
    case "codespan":
      return push(out, token.text, withMark(style, "code"));
    case "link":
      return inlineInto(out, token.tokens, { ...style, href: openableHref(token.href) });
    case "image":
      return push(out, prose(token.text) || "image", { ...style, href: openableHref(token.href) });
    case "br":
      return push(out, "\n", style);
    case "checkbox":
      return;
    default:
      return push(out, token.raw, style);
  }
};

/** Inline tokens as spans, adjacent runs of one style merged. */
export const spansOf = (tokens: ReadonlyArray<Token>): Spans => {
  const out: Array<Span> = [];

  inlineInto(out, tokens, PLAIN);

  return out;
};

const plainText = (spans: Spans) => spans.reduce((length, span) => length + span.text.length, 0);

const MAX_COLUMN_CHARS = 40;

const BULLETS = ["•", "◦", "▪"] as const;

const alignOf = (align: "center" | "left" | "right" | null): Align => align ?? "left";

const table = (token: Tokens.Table): Block => {
  const header = token.header.map((cell) => spansOf(cell.tokens));
  const rows = token.rows.map((row) => row.map((cell) => spansOf(cell.tokens)));

  const columnChars = header.map((cell, column) =>
    Math.min(
      MAX_COLUMN_CHARS,
      Math.max(plainText(cell), ...rows.map((row) => plainText(row[column] ?? [])))
    )
  );

  return { kind: "table", align: token.align.map(alignOf), header, rows, columnChars };
};

const list = (token: Tokens.List, depth: number): Block => {
  const start = token.start === "" ? 1 : token.start;
  const bullet = BULLETS[depth % BULLETS.length] ?? "•";

  const items = token.items.map((item, i): ListItem => ({
    marker: token.ordered ? `${start + i}.` : bullet,
    checked: item.task ? item.checked === true : null,
    blocks: blocksAt(item.tokens, depth + 1),
  }));

  return { kind: "list", items };
};

const paragraph = (spans: Spans): ReadonlyArray<Block> =>
  spans.length === 0 ? [] : [{ kind: "paragraph", spans }];

const blockOf = (token: MarkedToken, depth: number): ReadonlyArray<Block> => {
  switch (token.type) {
    case "space":
    case "def":
    case "checkbox":
      return [];
    case "paragraph":
      return paragraph(spansOf(token.tokens));
    case "text":
      return paragraph(token.tokens === undefined ? spansOf([token]) : spansOf(token.tokens));
    case "heading":
      return [{ kind: "heading", level: token.depth, spans: spansOf(token.tokens) }];
    case "code":
      return [{ kind: "code", lang: token.lang?.split(/\s/)[0] ?? "", text: token.text }];
    case "blockquote":
      return [{ kind: "quote", blocks: blocksAt(token.tokens, depth) }];
    case "list":
      return [list(token, depth)];
    case "table":
      return [table(token)];
    case "hr":
      return [{ kind: "rule" }];
    case "html":
      return paragraph(spansOf([{ type: "text", raw: token.raw, text: token.text.trim() }]));
    default:
      return paragraph(spansOf([{ type: "text", raw: token.raw, text: token.raw.trim() }]));
  }
};

const blocksAt = (tokens: ReadonlyArray<Token>, depth: number): ReadonlyArray<Block> =>
  tokens.flatMap((token) => blockOf(known(token), depth));

/** Top-level block tokens as blocks: one token gives none (a blank line, a link definition) or one. */
export const blocksOf = (tokens: ReadonlyArray<Token>): ReadonlyArray<Block> => blocksAt(tokens, 0);
