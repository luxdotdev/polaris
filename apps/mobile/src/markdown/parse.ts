/**
 * Markdown text to blocks, cheap while it streams. Text only grows at its end, so the blocks before
 * the last one are settled and kept, the same objects, and only the open block is lexed again.
 * The open block is completed first (remend, as Streamdown does), so `**bol` reads as bold.
 */
import { Lexer, type Links, type Token, type Tokens } from "marked";
import remend from "remend";
import type { Block } from "./model.ts";
import { blocksOf } from "./tokens.ts";

export interface Parsed {
  readonly text: string;
  readonly blocks: ReadonlyArray<Block>;
  /** Where the open block starts in `text`; everything before it is settled. */
  readonly settledLength: number;
  /** How many of `blocks` came from the settled text. */
  readonly settledBlocks: number;
  /** Link reference definitions in the settled text, for `[text][ref]` in later blocks. */
  readonly links: Links;
  /** Every definition the last parse saw, the open block's too. */
  readonly seenLinks: Links;
}

const EMPTY: Parsed = {
  text: "",
  blocks: [],
  settledLength: 0,
  settledBlocks: 0,
  links: {},
  seenLinks: {},
};

const lex = (src: string, links: Links) => {
  const lexer = new Lexer({ gfm: true });

  Object.assign(lexer.tokens.links, links);

  return lexer.lex(src);
};

/** Rewrites that hold wherever they are (`20~25` is not strikethrough), for settled blocks too. */
const settle = (text: string) =>
  remend(text, {
    bold: false,
    boldItalic: false,
    htmlTags: false,
    images: false,
    inlineCode: false,
    italic: false,
    katex: false,
    links: false,
    setextHeadings: false,
    strikethrough: false,
  });

/** Closes what the stream left open at the end: emphasis, inline code, a link still being typed. */
const complete = (text: string) => remend(text, { linkMode: "text-only", katex: false });

const rawLength = (tokens: ReadonlyArray<Token>) =>
  tokens.reduce((length, token) => length + token.raw.length, 0);

const openIndex = (tokens: ReadonlyArray<Token>) => {
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i]?.type !== "space") return i;

  return tokens.length;
};

const blocksFrom = (text: string, rewritten: string, tokens: ReadonlyArray<Token>, links: Links) =>
  blocksOf(rewritten === text ? tokens : lex(rewritten, links));

const isDefinition = (token: Token): token is Tokens.Def => token.type === "def";

const withDefinitions = (links: Links, tokens: ReadonlyArray<Token>): Links => {
  const out = { ...links };

  for (const token of tokens)
    if (isDefinition(token) && !Object.hasOwn(out, token.tag))
      out[token.tag] = { href: token.href, title: token.title };

  return out;
};

/** A definition that is new or changed may give an already settled `[text][ref]` its target. */
const definitionsChanged = (seen: Links, found: Links) =>
  Object.entries(found).some(
    ([label, link]) => seen[label]?.href !== link.href || seen[label]?.title !== link.title
  );

const parseWhole = (text: string): Parsed => {
  const tokens = lex(complete(text), {});

  return {
    text,
    blocks: blocksOf(tokens),
    settledLength: 0,
    settledBlocks: 0,
    links: {},
    seenLinks: tokens.links,
  };
};

const parseFrom = (base: Parsed, text: string): Parsed => {
  const tail = text.slice(base.settledLength);
  const tokens = lex(tail, base.links);

  if (base !== EMPTY && definitionsChanged(base.seenLinks, tokens.links))
    return parseFrom(EMPTY, text);

  // A lexer that dropped characters can't say where blocks start; then nothing settles.
  if (rawLength(tokens) !== tail.length) return parseWhole(text);

  const open = openIndex(tokens);
  const settledTokens = tokens.slice(0, open);
  const settledText = tail.slice(0, rawLength(settledTokens));
  const openText = tail.slice(settledText.length);

  const settled = blocksFrom(settledText, settle(settledText), settledTokens, base.links);
  const opened = blocksFrom(openText, complete(openText), tokens.slice(open), tokens.links);

  return {
    text,
    blocks: [...base.blocks.slice(0, base.settledBlocks), ...settled, ...opened],
    settledLength: base.settledLength + settledText.length,
    settledBlocks: base.settledBlocks + settled.length,
    links: withDefinitions(base.links, settledTokens),
    seenLinks: tokens.links,
  };
};

const normalize = (text: string) => (text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text);

/**
 * Parses `text`, continuing from `previous` when `text` extends it: the settled blocks are reused
 * as they are. Anything else (an edit, a shorter text) parses from the start.
 */
export const parseAfter = (previous: Parsed | null, text: string): Parsed => {
  const normalized = normalize(text);

  return parseFrom(
    previous !== null && normalized.startsWith(previous.text) ? previous : EMPTY,
    normalized
  );
};

const CACHE_SIZE = 64;

const cache = new Map<string, Parsed>();

const predecessorOf = (text: string) => {
  let best: Parsed | null = null;

  for (const parsed of cache.values())
    if (parsed.text.length > (best?.text.length ?? -1) && text.startsWith(parsed.text))
      best = parsed;

  return best;
};

/**
 * The blocks for a message, from a small cache: a finished message scrolled back into view is not
 * parsed again, and a streaming one continues from the text it had a moment ago.
 */
export const parseMarkdown = (source: string): Parsed => {
  const text = normalize(source);
  const hit = cache.get(text);

  if (hit !== undefined) {
    cache.delete(text);
    cache.set(text, hit);

    return hit;
  }

  const previous = predecessorOf(text);
  const parsed = parseAfter(previous, text);

  if (previous !== null) cache.delete(previous.text);

  cache.set(text, parsed);

  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next();

    if (oldest.done !== true) cache.delete(oldest.value);
  }

  return parsed;
};
