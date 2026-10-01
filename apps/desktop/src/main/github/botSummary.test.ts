import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { latestBotSummary, summaryBot } from "./botSummary.ts";

const body = readFileSync(
  new URL("../../../scripts/lib/githubFake/fixtures/suzuka.md", import.meta.url),
  "utf8"
);

const comment = {
  id: "suzuka-42",
  body,
  url: "https://example.test/42",
  updatedAt: "2026-10-01T00:00:00Z",
};

describe("bot summaries", () => {
  test("reads the supplied Suzuka format, alert verdict and reviewed SHAs", () => {
    expect(latestBotSummary([comment])).toMatchObject({
      bot: "suzuka",
      verdict: { alert: "warning", word: "Caution" },
      reviewedHead: "a".repeat(40),
      reviewedBase: "b".repeat(40),
    });
  });
  test("latest edited summary wins, with generic names and absent metadata allowed", () => {
    expect(
      latestBotSummary([
        comment,
        {
          ...comment,
          id: "other",
          body: "<!-- sentinel:summary -->\n> [!NOTE]\n> **Notice**\nHello",
          updatedAt: "2026-10-02T00:00:00Z",
        },
      ])
    ).toMatchObject({
      bot: "sentinel",
      verdict: { alert: "note", word: "Notice" },
      reviewedHead: null,
    });
  });
  test("only a leading marker pins a comment; arbitrary embedded text stays in the timeline", () => {
    expect(summaryBot("hello\n<!-- suzuka:summary -->")).toBeNull();
    expect(latestBotSummary([{ ...comment, body: "ordinary comment" }])).toBeNull();
  });
  test("the first alert controls the verdict, even if a later alert has a bold word", () => {
    expect(
      latestBotSummary([
        {
          ...comment,
          body: "<!-- suzuka:summary -->\n> [!NOTE]\n> No verdict\n\n> [!CAUTION]\n> **Later**",
        },
      ])?.verdict
    ).toBeNull();
  });
  test("does not borrow a bold word from prose after an alert", () => {
    expect(
      latestBotSummary([
        { ...comment, body: "<!-- suzuka:summary -->\n> [!TIP]\n\nUnrelated **text**" },
      ])?.verdict
    ).toBeNull();
  });
});
