/**
 * Code that grows, such as a fence in a streamed reply: each `update` passes the whole text so
 * far, only the new part is tokenized, and completed lines come back once as HTML.
 */
import { StreamTokenizer, type ThemedToken } from "@pierre/highlights";
import { highlightLanguage } from "./html.ts";
import { HIGHLIGHT_THEMES, type HighlightTheme } from "./theme.ts";

const ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ESCAPES.get(c) ?? c);

const ITALIC = 1;

const BOLD = 2;

const styleOf = (token: ThemedToken) => {
  const parts = token.color === undefined ? [] : [`color:${token.color}`];
  const flags = token.fontStyle ?? 0;

  if ((flags & ITALIC) !== 0) parts.push("font-style:italic");

  if ((flags & BOLD) !== 0) parts.push("font-weight:bold");

  return parts.join(";");
};

/** One line's tokens as spans, without the line break. */
export const lineToHtml = (tokens: ReadonlyArray<ThemedToken>): string =>
  tokens
    .map((token) => {
      const style = styleOf(token);
      const text = escape(token.content);

      return style === "" ? text : `<span style="${style}">${text}</span>`;
    })
    .join("");

export interface CodeStreamState {
  /** Every completed line so far, as HTML, in order. */
  readonly lines: ReadonlyArray<string>;
  /** The last, unfinished line as plain text; empty once the code ends with a newline. */
  readonly tail: string;
}

/**
 * A highlighter for one growing block of code. Text that no longer starts with what it saw
 * (an edited message) starts it over. Call `dispose` when the block goes.
 */
export class CodeStream {
  readonly #lang: string;
  readonly #theme: HighlightTheme;
  #tokenizer: StreamTokenizer | null = null;
  #seen = "";
  #lines: Array<string> = [];
  #ended = false;

  constructor(lang: string, theme: HighlightTheme) {
    this.#lang = lang;
    this.#theme = theme;
  }

  #tokenizerNow() {
    this.#tokenizer ??= new StreamTokenizer({
      lang: highlightLanguage(this.#lang),
      theme: HIGHLIGHT_THEMES[this.#theme],
    });

    return this.#tokenizer;
  }

  #reset() {
    this.#tokenizer?.dispose();
    this.#tokenizer = null;
    this.#seen = "";
    this.#lines = [];
    this.#ended = false;
  }

  #state(): CodeStreamState {
    const lastBreak = this.#seen.lastIndexOf("\n");

    return { lines: this.#lines, tail: this.#ended ? "" : this.#seen.slice(lastBreak + 1) };
  }

  /** The whole code so far; returns every completed line and the unfinished tail. */
  update(code: string): CodeStreamState {
    if (this.#ended && code === this.#seen) return this.#state();

    if (this.#ended || !code.startsWith(this.#seen)) this.#reset();
    const added = code.slice(this.#seen.length);

    if (added !== "") {
      for (const line of this.#tokenizerNow().pushCode(added)) this.#lines.push(lineToHtml(line));
      this.#seen = code;
    }

    return this.#state();
  }

  /** The code is complete: its last line is highlighted too. */
  end(code: string = this.#seen): CodeStreamState {
    this.update(code);

    if (!this.#ended) {
      const rest = this.#tokenizerNow().end();
      // A trailing newline yields a final empty line, which a code block doesn't draw.
      const last = code.endsWith("\n") ? rest.slice(0, -1) : rest;

      for (const line of last) this.#lines.push(lineToHtml(line));
      this.#tokenizer?.dispose();
      this.#tokenizer = null;
      this.#ended = true;
    }

    return this.#state();
  }

  dispose() {
    this.#reset();
  }
}
