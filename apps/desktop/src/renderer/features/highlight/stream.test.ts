import { describe, expect, test } from "bun:test";
import { highlightToHtml } from "./html.ts";
import { CodeStream, type CodeStreamState } from "./stream.ts";

/** A line as runs of [colour, text]; uncoloured text takes the block's own colour. */
type Runs = Array<[string, string]>;

const DEFAULT = "var(--color-text-default)";

const ENTITIES = new Map([
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&amp;", "&"],
]);

const unescape = (text: string) =>
  text.replace(/&(?:lt|gt|quot|amp);/g, (e) => ENTITIES.get(e) ?? e);

/** Appends `text` in `colour` to the last line, merged with a same-colour neighbour. */
const append = (lines: Array<Runs>, colour: string, text: string) => {
  for (const [at, part] of text.split("\n").entries()) {
    if (at > 0) lines.push([]);
    const line = lines.at(-1) ?? [];
    const piece = part.replace(/\r$/, "");
    const last = line.at(-1);

    if (piece === "") continue;

    if (last?.[0] === colour) last[1] += piece;
    else line.push([colour, piece]);
  }
};

/** Coloured characters of an HTML fragment, split into lines, same-colour neighbours merged. */
const linesOf = (html: string): Array<Runs> => {
  const lines: Array<Runs> = [[]];
  const colours = [DEFAULT];

  for (const [, open, close, text] of html.matchAll(/(<span[^>]*>)|(<\/span>)|([^<]+)/g)) {
    const current = colours.at(-1) ?? DEFAULT;

    if (open !== undefined) colours.push(/color:([^;"]+)/.exec(open)?.[1] ?? current);
    else if (close !== undefined) colours.pop();
    else append(lines, current, unescape(text ?? ""));
  }

  return lines;
};

/** What Highlights' own HTML renderer draws for the whole code, line by line. */
const whole = (code: string, lang = "ts") => {
  const inner = /<code>([\s\S]*)<\/code>/.exec(highlightToHtml(code, lang, "moonlit"))?.[1] ?? "";
  const lines = linesOf(inner);

  // A final newline ends the last line; it doesn't start an empty one.
  return code.endsWith("\n") ? lines.slice(0, -1) : lines;
};

/** What the stream draws: its lines, then the tail as uncoloured text. */
const drawn = ({ lines, tail }: CodeStreamState): Array<Runs> => {
  const runs = lines.map((line) => linesOf(line)[0] ?? []);

  return tail === "" ? runs : [...runs, [[DEFAULT, tail]]];
};

const streamed = (code: string, chunks: ReadonlyArray<number>, lang = "ts") => {
  const stream = new CodeStream(lang, "moonlit");
  let at = 0;

  for (const size of chunks) stream.update(code.slice(0, (at += size)));
  const state = stream.end(code);

  stream.dispose();

  return state;
};

const SAMPLE = 'const a = "<b>";\n/* open\n still */ let b = 2;\nfn(a, b)';

describe("CodeStream against Highlights' own HTML", () => {
  test("rewrites that don't append (an edited reply) draw the new code whole", () => {
    const stream = new CodeStream("ts", "moonlit");

    stream.update("/* a comment\nstill a comment\n");
    // The comment no longer opens: the second line must lose its comment colour.
    const edited = "const a = 1;\nstill a comment\n";

    expect(drawn(stream.update(edited))).toEqual(whole(edited));
    // A rewrite inside the unfinished line.
    stream.update("const a = 1;\nlet x");
    expect(drawn(stream.end("const a = 1;\nvar y = 2;"))).toEqual(
      whole("const a = 1;\nvar y = 2;")
    );
    stream.dispose();
  });

  test("shrinking to empty draws nothing, then starts over", () => {
    const stream = new CodeStream("ts", "moonlit");

    stream.update("/* open\nlet a");
    expect(stream.update("")).toEqual({ lines: [], tail: "" });
    expect(drawn(stream.end("let a = 1;\n"))).toEqual(whole("let a = 1;\n"));
    stream.dispose();
  });

  test("a CRLF split across chunks ends the line once, with no stray CR", () => {
    const code = "let a = 1;\r\nlet b = 2;\r\n";
    const stream = new CodeStream("ts", "moonlit");

    const mid = stream.update("let a = 1;\r");

    expect(mid.tail).toBe("let a = 1;");
    expect(drawn(stream.update("let a = 1;\r\nlet"))).toEqual([
      ...whole("let a = 1;\n"),
      [[DEFAULT, "let"]],
    ]);
    const { lines } = stream.end(code);

    expect(lines.join("")).not.toContain("\r");
    expect(drawn({ lines, tail: "" })).toEqual(whole(code));
    stream.dispose();
  });

  test.each([
    ["unterminated", SAMPLE],
    ["ending in a newline", `${SAMPLE}\n`],
  ])("a last line %s draws as the whole code does", (_, code) => {
    for (const chunks of [[1, 1, 1, 5, 9], [code.length], [17, 3, 30]])
      expect(drawn(streamed(code, chunks))).toEqual(whole(code));
  });

  test("an unfinished last line waits as plain text", () => {
    const stream = new CodeStream("ts", "moonlit");

    expect(drawn(stream.update("let a = 1;\nconst"))).toEqual([
      ...whole("let a = 1;"),
      [[DEFAULT, "const"]],
    ]);
    stream.dispose();
  });

  test.each(["not-a-language", ""])(
    "an unknown language (%p) draws plain, escaped text",
    (lang) => {
      const code = "if (a < b && c) {\n  <tag>\n}";
      const state = streamed(code, [4, 9, 20], lang);

      expect(drawn(state)).toEqual(whole(code, lang));
      expect(
        drawn(state)
          .flat()
          .map(([colour]) => colour)
      ).toEqual([DEFAULT, DEFAULT, DEFAULT]);
      expect(state.lines.join("")).not.toContain("<tag>");
    }
  );

  test("a very long line streams in chunks and draws as the whole code does", () => {
    const code = `const s = "${"x<&".repeat(40_000)}"; let n = 1;\nlet m = 2;`;
    const chunks = Array.from({ length: Math.ceil(code.length / 4096) }, () => 4096);
    const stream = new CodeStream("ts", "moonlit");
    let at = 0;

    for (const size of chunks.slice(0, -2)) {
      const { lines, tail } = stream.update(code.slice(0, (at += size)));

      expect(lines).toEqual([]);
      expect(tail).toBe(code.slice(0, at));
    }

    expect(drawn(stream.end(code))).toEqual(whole(code));
    stream.dispose();
  });
});
