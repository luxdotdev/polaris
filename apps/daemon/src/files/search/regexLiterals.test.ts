import { describe, expect, test } from "bun:test"
import { requiredLiterals } from "./regexLiterals.ts"

const texts = (pattern: string) => requiredLiterals(pattern)?.map((l) => l.text) ?? null

describe("requiredLiterals", () => {
  test("plain concatenations, broken by anything that isn't a literal word character", () => {
    expect(texts("needleBench")).toEqual(["needleBench"])
    expect(texts("export const needle\\w+ = true")).toEqual(["export", "const", "needle", "true"])
    expect(texts("foo.bar")).toEqual(["foo", "bar"])
    expect(texts("^fn main\\(\\)$")).toEqual(["fn", "main"])
    expect(texts("\\bword\\b")).toEqual(["word"])
  })

  test("escaped metacharacters are literal but end a word literal", () => {
    expect(texts("a\\.b\\*cde\\+\\+")).toEqual(["a", "b", "cde"])
    expect(texts("\\\\server")).toEqual(["server"])
  })

  test("optional and repeated parts", () => {
    expect(texts("colou?r")).toEqual(["colo", "r"])
    expect(texts("abc(def)?ghi")).toEqual(["abc", "ghi"])
    expect(texts("abc(def)*ghi")).toEqual(["abc", "ghi"])
    expect(texts("abc(def)+ghi")).toEqual(["abc", "def", "ghi"])
    expect(texts("(ab){3}")).toEqual(["ababab"])
    expect(texts("x{0,2}yz")).toEqual(["yz"])
    expect(texts("ab+?c")).toEqual(["a", "b", "c"])
  })

  test("alternation keeps only what every branch shares", () => {
    expect(texts("foo|bar")).toEqual([])
    expect(texts("(get|set)Value")).toEqual(["Value"])
    expect(texts("parseInt|parseFloat")).toEqual(["parse"])
    expect(texts("xhandlerx|yhandlery|handlerz")).toEqual(["handler"])
    expect(texts("abc|")).toEqual([])
    expect(texts("(same|same)tail")).toEqual(["sametail"])
  })

  test("character classes never contribute", () => {
    expect(texts("[abc]def")).toEqual(["def"])
    expect(texts("id[]x]yz")).toEqual(["id", "yz"])
    expect(texts("a[[:alpha:]]bcd")).toEqual(["a", "bcd"])
    expect(texts("pre[a-z&&[^x]]post")).toEqual(["pre", "post"])
    expect(texts("[^\\]]+tail")).toEqual(["tail"])
  })

  test("case-insensitive parts are marked and leave out k and s", () => {
    expect(requiredLiterals("(?i)needle")).toEqual([{ text: "needle", caseInsensitive: true }])
    expect(texts("(?i)checkpoint")).toEqual(["chec", "point"])
    expect(texts("(?i)session")).toEqual(["e", "ion"])
    expect(requiredLiterals("abc(?i:def)ghi")).toEqual([
      { text: "abcdefghi", caseInsensitive: true },
    ])
    expect(requiredLiterals("(?i)abc(?-i)DEF")).toEqual([{ text: "abcDEF", caseInsensitive: true }])
    expect(requiredLiterals("a(?i)bcd|xBCD")).toEqual([{ text: "bcd", caseInsensitive: true }])
  })

  test("non-ASCII letters are literal only when case-sensitive", () => {
    expect(texts("größe")).toEqual(["größe"])
    expect(texts("(?i)größe")).toEqual(["gr", "e"])
  })

  test("named groups and harmless flags", () => {
    expect(texts("(?P<name>abc)def")).toEqual(["abcdef"])
    expect(texts("(?<name>abc)def")).toEqual(["abcdef"])
    expect(texts("(?m)^abc$")).toEqual(["abc"])
    expect(texts("(?s:a.b)cde")).toEqual(["a", "b", "cde"])
  })

  test("patterns it doesn't model give null (no narrowing)", () => {
    for (const pattern of [
      "(?x) a b c",
      "\\x41bc",
      "\\p{Greek}abc",
      "abc\\/def",
      "(?=lookahead)",
      "a{2",
      "(unclosed",
      "*oops",
      "abc**",
    ]) {
      expect(requiredLiterals(pattern)).toBeNull()
    }
  })
})
