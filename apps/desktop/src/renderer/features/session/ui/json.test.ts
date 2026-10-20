import { describe, expect, test } from "bun:test";
import { jsonTokens, looksLikeJson } from "./json.tsx";

const kinds = (text: string) =>
  jsonTokens(text)
    .filter((t) => t.kind !== "plain")
    .map((t) => `${t.kind}:${t.text}`);

describe("jsonTokens", () => {
  test("tells keys from string values, and colours numbers and literals alike", () => {
    expect(kinds('{"id": "ENG-391", "n": -1.5e3, "ok": true, "x": null}')).toEqual([
      "punctuation:{",
      'key:"id"',
      "punctuation::",
      'string:"ENG-391"',
      "punctuation:,",
      'key:"n"',
      "punctuation::",
      "literal:-1.5e3",
      "punctuation:,",
      'key:"ok"',
      "punctuation::",
      "literal:true",
      "punctuation:,",
      'key:"x"',
      "punctuation::",
      "literal:null",
      "punctuation:}",
    ]);
  });

  test("an escaped quote stays inside its string", () => {
    expect(kinds('["say \\"hi\\"", 2]')).toEqual([
      "punctuation:[",
      'string:"say \\"hi\\""',
      "punctuation:,",
      "literal:2",
      "punctuation:]",
    ]);
  });

  test("a line cut short mid-string still colours, and the text is kept whole", () => {
    const cut = '{"title":"Images in assistant messages load from the sess…';

    expect(kinds(cut).at(-1)).toBe('string:"Images in assistant messages load from the sess…');
    expect(
      jsonTokens(cut)
        .map((t) => t.text)
        .join("")
    ).toBe(cut);
  });

  test("only an object or array reads as JSON", () => {
    expect(looksLikeJson('  {"a": 1}')).toBe(true);
    expect(looksLikeJson("[1, 2]")).toBe(true);
    expect(looksLikeJson("Created ENG-391")).toBe(false);
    expect(looksLikeJson('"just a string"')).toBe(false);
  });
});
