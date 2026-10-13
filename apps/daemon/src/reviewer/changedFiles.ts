/**
 * The parts of a change both the Reviewer's and the Walkthrough's prompts share: the list of
 * every changed path with its stats, and the patches fitted to a budget whole file by whole
 * file, generated files left out, the rest named so they can be read with git.
 */
import type { ChangeDiff, DiffFile } from "./diff.ts";

/** The diff text a prompt carries at most; past it, files are listed to read with git. */
export const DIFF_BUDGET_CHARS = 240_000;

const tags = (file: DiffFile, generated: ReadonlySet<string>) =>
  [generated.has(file.path) ? " [generated]" : "", file.binary ? " [binary]" : ""].join("");

/** `M src/a.ts +12 -3`, one line per file, in diff order. */
export const changedFilesSection = (diff: ChangeDiff, generated: ReadonlySet<string>): string => {
  const added = diff.files.reduce((n, f) => n + f.additions, 0);
  const deleted = diff.files.reduce((n, f) => n + f.deletions, 0);
  const count = diff.files.length;

  return [
    `## Changed files (${count} ${count === 1 ? "file" : "files"}, +${added} -${deleted})`,
    "",
    ...diff.files.map(
      (f) => `${f.status} ${f.path} +${f.additions} -${f.deletions}${tags(f, generated)}`
    ),
  ].join("\n");
};

export interface FittedDiff {
  /** Whole patches, in diff order, within the budget. */
  readonly shown: ReadonlyArray<string>;
  /** Files that didn't fit. */
  readonly left: ReadonlyArray<string>;
  /** Generated files: never sent, only listed. */
  readonly generated: ReadonlyArray<string>;
}

export const fitDiff = (
  diff: ChangeDiff,
  generated: ReadonlySet<string>,
  budget = DIFF_BUDGET_CHARS
): FittedDiff => {
  const shown: Array<string> = [];
  const left: Array<string> = [];
  const skipped: Array<string> = [];
  let used = 0;

  for (const file of diff.files) {
    if (generated.has(file.path)) skipped.push(file.path);
    else if (used + file.patch.length <= budget) {
      shown.push(file.patch);
      used += file.patch.length;
    } else left.push(file.path);
  }

  return { shown, left, generated: skipped };
};

/** The fitted diff as a prompt section, with what was left out and how to read it. */
export const diffSection = (
  diff: ChangeDiff,
  generated: ReadonlySet<string>,
  base: string,
  head: string
): string => {
  const fitted = fitDiff(diff, generated);
  const read = `\`git diff ${base} ${head} -- <path>\``;

  const parts = [
    `## The diff (\`git diff ${base} ${head}\`)`,
    "",
    "```diff",
    ...fitted.shown,
    "```",
  ];

  if (fitted.left.length > 0) {
    parts.push(
      "",
      `These files changed too but didn't fit; read them with ${read}:`,
      ...fitted.left.map((p) => `- ${p}`)
    );
  }

  if (fitted.generated.length > 0) {
    parts.push(
      "",
      `These generated files and lockfiles are left out; read one with ${read} only if the change depends on it:`,
      ...fitted.generated.map((p) => `- ${p}`)
    );
  }

  return parts.join("\n");
};
