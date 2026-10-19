/**
 * A Turn's reply as a short plain-text preview (`Turn.replyPreview`): what a "finished a turn"
 * notification shows, so Clients needn't load the Turn's items.
 */

/** About how long a preview is; it ends on a word boundary, with an ellipsis when cut. */
export const REPLY_PREVIEW_LENGTH = 200;

/** Only a reply's start can reach the preview, so a long reply is read this far. */
const SCANNED = 4_000;

/** The shortest cut at a word boundary; a single long word is cut inside it instead. */
const MIN_WORD_CUT = REPLY_PREVIEW_LENGTH / 2;

const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/** Line-level Markdown: fences, headings, quotes, list markers, rules, tables, link definitions. */
const blocks = (text: string): string =>
  text
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, "")
    .replace(/^ {0,3}\[[^\]]+\]:\s+\S+.*$/gm, "")
    .replace(/^ {0,3}([-*_])( *\1){2,} *$/gm, "")
    .replace(/^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/gm, "")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}(> ?)+/gm, "")
    .replace(/^\s*([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/^ *\|(.*)\| *$/gm, (_, cells: string) => cells.replaceAll("|", " "));

/** Escaped punctuation moves to the Private Use Area until the end, so no rule reads it. */
const ESCAPED = 0xe000;

const hide = (text: string): string =>
  text.replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, (_, c: string) =>
    String.fromCharCode(ESCAPED + c.charCodeAt(0))
  );

const unhide = (text: string): string =>
  text.replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - ESCAPED));

/** Inline Markdown outside code spans: images, links, HTML, emphasis. */
const inline = (text: string): string =>
  hide(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\](\([^)]*\)|\[[^\]]*\])/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(?<![\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, "$1")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");

/** Inline Markdown stripped, code spans kept as their text. */
const withoutInline = (text: string): string => {
  let out = "";
  let from = 0;

  for (const match of text.matchAll(CODE_SPAN)) {
    out += inline(text.slice(from, match.index)) + (match[2] ?? "").trim();
    from = match.index + match[0].length;
  }

  return out + inline(text.slice(from));
};

/** Readable text: Markdown stripped, whitespace collapsed. */
export const plainText = (markdown: string): string =>
  unhide(withoutInline(blocks(markdown)))
    .replace(/\s+/g, " ")
    .trim();

/** `text` cut to `REPLY_PREVIEW_LENGTH` on a word boundary, with an ellipsis when cut. */
const cut = (text: string, longer: boolean): string => {
  if (text.length <= REPLY_PREVIEW_LENGTH) return longer ? `${text}…` : text;
  const head = text.slice(0, REPLY_PREVIEW_LENGTH + 1);
  const space = head.lastIndexOf(" ");
  const kept = space >= MIN_WORD_CUT ? head.slice(0, space) : head.slice(0, REPLY_PREVIEW_LENGTH);

  return `${kept.replace(/[\s,;:.\-–—]+$/, "")}…`;
};

/** The preview of a reply, or null when it has no readable text. */
export const replyPreview = (markdown: string): string | null => {
  const text = plainText(markdown.slice(0, SCANNED));

  return text === "" ? null : cut(text, markdown.length > SCANNED);
};
