/**
 * A shell command's colours (DESIGN.md, rule/syntax-is-moonlit), from CodeMirror's shell
 * mode run synchronously over the text: commands, keywords and flags, strings, variables,
 * operators and comments. Small enough to colour every command row as it renders.
 */
import { StringStream } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { LineRuns, SyntaxGroup, SyntaxRun } from "../diffSyntax.ts";

/** Past this a command stays plain: a pasted script isn't worth a long tokenize. */
const MAX_CHARS = 20_000;

/** The mode's styles as moonlit groups; words and operators are placed by position below. */
const GROUPS = new Map<string, SyntaxGroup>([
  ["keyword", "keyword"],
  ["atom", "keyword"],
  ["attribute", "keyword"],
  ["string", "string"],
  ["quote", "string"],
  ["string.special", "string"],
  ["def", "type"],
  ["comment", "comment"],
  ["meta", "comment"],
  ["operator", "punctuation"],
]);

const SEPARATOR = /^[|&;()<>]+$/;

/** A separator after which the next word names a command (`&&`, `|`, `;`, `(`), not `>&`. */
const STARTS_COMMAND = /^[|&;(]+$/;

const WORD = /^[^\s|&;()<>]+$/;

interface Token {
  readonly text: string;
  /** The mode's style; "word" for an unstyled word, "separator" for `|`, `&&`, `>`… */
  readonly style: string;
}

const kindOf = (text: string, style: string | null): string => {
  if (style !== null && style !== "builtin") return style;

  // A `\` continuation at the end of a line, not an escape like `\;`.
  if (text === "\\") return "space";

  if (SEPARATOR.test(text)) return "separator";

  return WORD.test(text) ? "word" : "space";
};

/** One line's tokens, adjacent words and separators joined (`./bin/run`, `&&`, `>&`). */
const lineTokens = (line: string, next: (stream: StringStream) => string | null): Array<Token> => {
  const stream = new StringStream(line, 2, 2);
  const tokens: Array<Token> = [];

  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = next(stream);

    if (stream.pos === stream.start) stream.pos++;
    const text = stream.current();
    const kind = kindOf(text, style);
    const last = tokens.at(-1);

    if (last !== undefined && last.style === kind && (kind === "word" || kind === "separator")) {
      tokens[tokens.length - 1] = { text: last.text + text, style: kind };
    } else tokens.push({ text, style: kind });
  }

  return tokens;
};

const isAssignment = (token: Token) => token.style === "def" && !token.text.startsWith("$");

/** Walks a line's tokens, colouring each word in command position as a command. */
class Colourer {
  command = true;

  private assigning = false;

  group(token: Token): SyntaxGroup | null {
    if (token.style === "space") return null;
    const wasAssigning = this.assigning;

    this.assigning = token.style === "operator" && token.text === "=";

    if (token.style === "separator") {
      this.command = STARTS_COMMAND.test(token.text);

      return "punctuation";
    }

    // A keyword past the command is an argument (`echo done`).
    if (token.style === "keyword" && !this.command) return null;

    if (token.style === "word") {
      // `FOO=bar cmd`: the value is plain and a command can still follow.
      if (wasAssigning) return null;
      const named = this.command;

      this.command = false;

      return named ? "function" : null;
    }

    // Keywords (`then`, `do`), assignments and their `=` leave the command still to come.
    if (token.style !== "keyword" && token.style !== "operator" && !isAssignment(token)) {
      this.command = false;
    }

    return GROUPS.get(token.style) ?? null;
  }
}

const push = (runs: Array<SyntaxRun>, text: string, group: SyntaxGroup | null) => {
  const last = runs.at(-1);

  if (last !== undefined && last.group === group) {
    runs[runs.length - 1] = { text: last.text + text, group };
  } else runs.push({ text, group });
};

/** `command`'s runs, spelling it exactly; one plain run when it's too long to colour. */
export const shellRuns = (command: string): LineRuns => {
  if (command.length > MAX_CHARS) return [{ text: command, group: null }];
  const state = shell.startState?.(2) ?? {};
  const next = (stream: StringStream) => shell.token(stream, state);
  const colourer = new Colourer();
  const runs: Array<SyntaxRun> = [];

  command.split("\n").forEach((line, index) => {
    if (index > 0) push(runs, "\n", null);

    for (const token of lineTokens(line, next)) push(runs, token.text, colourer.group(token));

    // The next line starts a command unless this one ends in a `\` continuation.
    if (!line.trimEnd().endsWith("\\")) colourer.command = true;
  });

  return runs;
};
