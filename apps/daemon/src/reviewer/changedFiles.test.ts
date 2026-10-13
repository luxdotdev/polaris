import { describe, expect, test } from "bun:test";
import { changedFilesSection, fitDiff } from "./changedFiles.ts";
import { parseDiff } from "./diff.ts";
import { reviewPrompt, REVIEWER_MARKER } from "./prompt.ts";
import { WALKTHROUGH_MARKER, walkthroughPrompt } from "./walkthroughPrompt.ts";

const filePatch = (path: string, lines: number, mode: "new" | "edit" = "edit") =>
  [
    `diff --git a/${path} b/${path}`,
    ...(mode === "new" ? ["new file mode 100644", "--- /dev/null"] : [`--- a/${path}`]),
    `+++ b/${path}`,
    `@@ -1,1 +1,${lines} @@`,
    "-old",
    ...Array.from({ length: lines }, (_, i) => `+line ${i} ${"x".repeat(60)}`),
  ].join("\n");

const diff = parseDiff(
  [
    filePatch("src/core.ts", 3),
    filePatch("bun.lock", 5000),
    filePatch("src/big.ts", 4000, "new"),
    filePatch("src/after.ts", 2),
  ].join("\n")
);

const generated = new Set(["bun.lock"]);

const walkthrough = () =>
  walkthroughPrompt({
    title: "Pull request #1: Thing",
    base: "b1",
    head: "h1",
    fromHead: null,
    diff,
    generated,
    context: "",
    findings: [],
    instructions: "",
    shell: "checks",
  });

const review = () =>
  reviewPrompt({
    subject: "Pull request #1: Thing",
    why: null,
    instructions: null,
    ruleFindings: [],
    diff,
    generated,
    base: "b1",
    head: "h1",
    since: null,
    earlierFindings: [],
    shell: "checks",
  });

describe("the prompts' view of a change", () => {
  test("every changed path with its status and counts, generated and binary tagged", () => {
    expect(changedFilesSection(diff, generated).split("\n")).toEqual([
      "## Changed files (4 files, +9005 -4)",
      "",
      "M src/core.ts +3 -1",
      "M bun.lock +5000 -1 [generated]",
      "A src/big.ts +4000 -1",
      "M src/after.ts +2 -1",
    ]);
  });

  test("whole files up to the budget; generated files never sent; the rest named", () => {
    const fitted = fitDiff(diff, generated, 400_000);

    expect(fitted.shown.map((p) => p.split("\n")[0])).toEqual([
      "diff --git a/src/core.ts b/src/core.ts",
      "diff --git a/src/big.ts b/src/big.ts",
      "diff --git a/src/after.ts b/src/after.ts",
    ]);
    expect(fitted.generated).toEqual(["bun.lock"]);

    const tight = fitDiff(diff, generated, 1_000);

    expect(tight.left).toEqual(["src/big.ts"]);
    expect(tight.shown).toHaveLength(2);
  });

  for (const [name, build, marker] of [
    ["Walkthrough", walkthrough, WALKTHROUGH_MARKER],
    ["Reviewer", review, REVIEWER_MARKER],
  ] as const) {
    test(`the ${name} prompt starts with the changed files and leaves lockfile bodies out`, () => {
      const prompt = build();

      expect(prompt.startsWith(marker)).toBe(true);
      // The file list comes before the subject and the diff.
      expect(prompt.indexOf("## Changed files")).toBeLessThan(prompt.indexOf("Pull request #1"));
      expect(prompt).toContain("M bun.lock +5000 -1 [generated]");
      expect(prompt).not.toContain("diff --git a/bun.lock");
      expect(prompt).toContain("These generated files and lockfiles are left out");
    });
  }

  test("a Walkthrough past the budget keeps whole files and names the ones left out", () => {
    const huge = parseDiff(
      [filePatch("src/a.ts", 2500), filePatch("src/b.ts", 2500), filePatch("src/c.ts", 3)].join(
        "\n"
      )
    );

    const prompt = walkthroughPrompt({
      title: "t",
      base: "b1",
      head: "h1",
      fromHead: null,
      diff: huge,
      generated: new Set(),
      context: "",
      findings: [],
      instructions: "",
      shell: "git",
    });

    // b.ts doesn't fit after a.ts, but the smaller c.ts after it still does, whole.
    expect(prompt).toContain(`+line 2499 ${"x".repeat(60)}`);
    expect(prompt).not.toContain("diff --git a/src/b.ts");
    expect(prompt).toContain("diff --git a/src/c.ts");
    expect(prompt).toContain("didn't fit; read them with `git diff b1 h1 -- <path>`:\n- src/b.ts");
  });
});
