import { describe, expect, test } from "bun:test";
import { itemScore, rank, wordScore } from "./ranking.ts";

const item = (title: string, keywords: ReadonlyArray<string> = [], needsYou = false) => ({
  title,
  keywords,
  needsYou,
});

describe("jump ranking", () => {
  test("a prefix beats a word start, which beats a scattered match", () => {
    const prefix = wordScore("po", "polaris") ?? 0;
    const wordStart = wordScore("po", "migrate to postgres") ?? 0;
    const scattered = wordScore("pol", "people only") ?? 0;

    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(scattered);
    expect(wordScore("zz", "polaris")).toBeNull();
  });

  test("short words and keywords must appear as written; scattered letters only in titles, 3+ letters", () => {
    expect(wordScore("pa", "people only")).toBeNull();
    expect(wordScore("pln", "polaris planning")).not.toBeNull();
    expect(itemScore("po", item("Dotfiles cleanup", ["MacBook Pro"]))).toBeNull();
    expect(itemScore("pro", item("Dotfiles cleanup", ["MacBook Pro"]))).not.toBeNull();
  });

  test("every word must match, in the title or a keyword", () => {
    const planning = item("Polaris planning", ["Mac Studio", "polaris", "working", "Claude Code"]);

    expect(itemScore("plan working", planning)).not.toBeNull();
    expect(itemScore("plan codex", planning)).toBeNull();
  });

  test("the title outweighs keywords", () => {
    const byTitle = itemScore("dcai", item("dcai")) ?? 0;
    const byKeyword = itemScore("dcai", item("Migrate reports", ["dcai"])) ?? 0;

    expect(byTitle).toBeGreaterThan(byKeyword);
  });

  test("Needs You first, then score (a tighter prefix wins)", () => {
    const items = [
      item("Polaris planning", ["polaris"]),
      item("Spike GPUI review screen", ["polaris"], true),
      item("Portal", []),
    ];

    const ranked = rank({
      query: "po",
      items,
      urgent: (i) => i.needsYou,
      limit: 10,
    });

    expect(ranked.map((i) => i.title)).toEqual([
      "Spike GPUI review screen",
      "Portal",
      "Polaris planning",
    ]);
  });

  test("an empty query keeps everything, most recent first, up to the limit", () => {
    const items = [item("a"), item("b"), item("c")];

    const order = new Map([
      ["c", 0],
      ["a", 1],
    ]);

    const ranked = rank({
      query: " ",
      items,
      recency: (i) => order.get(i.title) ?? 99,
      limit: 2,
    });

    expect(ranked.map((i) => i.title)).toEqual(["c", "a"]);
  });
});
