import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { parseGroups, splitGroups } from "./groups.ts";

const group = (key: string, paths: ReadonlyArray<string>, category = "core") => ({
  key,
  label: key,
  summary: `Why ${key}.`,
  category,
  critical: false,
  paths,
});

const block = (groups: ReadonlyArray<unknown>) =>
  `## Intent groups\n\`\`\`json\n${JSON.stringify({ groups })}\n\`\`\``;

const outline =
  "## Why the change\nOne.\n\n## Special things to note\nNone\n\n## Change outline\nx";

describe("intent groups", () => {
  test("the groups section leaves the walkthrough's Markdown", () => {
    const split = splitGroups(`${outline}\n\n${block([group("a", ["a.ts"])])}`);

    expect(split.markdown).toBe(outline);
    expect(split.block?.startsWith("## Intent groups")).toBe(true);
    expect(splitGroups(outline)).toEqual({ markdown: outline, block: null });
  });

  test("groups covering every path decode, in their order", () => {
    const parsed = parseGroups(
      block([group("core", ["src/a.ts"]), group("tests", ["src/a.test.ts"], "tests")]),
      ["src/a.test.ts", "src/a.ts"]
    );

    expect(Result.isSuccess(parsed)).toBe(true);
    expect(Result.getOrThrow(parsed).map((g) => g.key)).toEqual(["core", "tests"]);
  });

  test("missing, duplicated and unknown paths are named back", () => {
    const parsed = parseGroups(block([group("a", ["a.ts", "a.ts", "z.ts"])]), ["a.ts", "b.ts"]);

    expect(Result.isFailure(parsed) && parsed.failure).toBe(
      "Missing paths: b.ts\nDuplicated paths: a.ts\nUnknown paths: z.ts"
    );
  });

  test("no section, no JSON, or the wrong shape is a problem, not a crash", () => {
    expect(Result.isFailure(parseGroups(null, ["a.ts"]))).toBe(true);
    expect(Result.isFailure(parseGroups("## Intent groups\nnone", ["a.ts"]))).toBe(true);
    expect(Result.isFailure(parseGroups("```json\n{oops\n```", ["a.ts"]))).toBe(true);

    expect(
      Result.isFailure(parseGroups(block([group("a", ["a.ts"], "colourful")]), ["a.ts"]))
    ).toBe(true);
  });

  test("an empty group is dropped", () => {
    const parsed = parseGroups(block([group("a", ["a.ts"]), group("b", [])]), ["a.ts"]);

    expect(Result.getOrThrow(parsed).map((g) => g.key)).toEqual(["a"]);
  });
});
