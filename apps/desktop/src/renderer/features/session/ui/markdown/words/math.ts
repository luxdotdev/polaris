/**
 * Math delimiters for Words (ADR 0115). Words reads `$…$` and `$$…$$`; assistants also write
 * `\(…\)` and `\[…\]`. A lone `$` stays a dollar, as it did under Streamdown, so `$HOME/$USER`
 * never turns into a formula. Code (fences and inline spans) is left as written.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const INLINE_CODE = /(`+)[\s\S]*?(?<!`)\1(?!`)/g;

/** `$$…$$` (or an open `$$` to the end), `\(…\)`, `\[…\]`, an escaped `\$`, a lone `$`. */
const MATH = /\$\$[\s\S]*?(?:\$\$|$(?![\s\S]))|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\\\$|\$/g;

const prose = (text: string): string =>
  text.replace(MATH, (match, inline: string | undefined, display: string | undefined) => {
    if (inline !== undefined) return inline.trim() === "" ? match : `$${inline.trim()}$`;

    if (display !== undefined) return display.trim() === "" ? match : `$$${display}$$`;

    return match === "$" ? "\\$" : match;
  });

/** Prose with its inline code spans kept as written. */
const outsideInlineCode = (text: string): string => {
  let out = "";
  let at = 0;

  for (const span of text.matchAll(INLINE_CODE)) {
    out += prose(text.slice(at, span.index)) + span[0];
    at = span.index + span[0].length;
  }

  return out + prose(text.slice(at));
};

/** The text with `\(…\)` and `\[…\]` as Words' math, and lone `$` escaped, outside code. */
export const normalizeMath = (text: string): string => {
  if (!/[$\\]/.test(text)) return text;
  const lines = text.split("\n");
  const out: Array<string> = [];
  let fence: string | null = null;
  let chunk: Array<string> = [];

  const flush = () => {
    if (chunk.length > 0) out.push(outsideInlineCode(chunk.join("\n")));
    chunk = [];
  };

  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1] ?? null;

    if (fence === null && marker !== null) {
      flush();
      fence = marker;
      out.push(line);
    } else if (fence !== null) {
      out.push(line);

      if (marker !== null && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else chunk.push(line);
  }

  flush();

  return out.join("\n");
};
