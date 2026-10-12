/**
 * Files Review treats as noise: generated files (the Daemon's verdict, which adds the repo's
 * `.gitattributes` and `.polaris/review.md`; built-in patterns from older Daemons) and tests.
 */
import { isGeneratedPath, isTestPath } from "@polaris/protocol";
import type { ReviewFile, ReviewSection } from "./layout.ts";
import type { PatchFile } from "./patch.ts";

export interface Noise {
  readonly generated: boolean;
  readonly test: boolean;
}

export const noiseOf = (file: PatchFile): Noise => {
  const generated = file.generated ?? isGeneratedPath(file.path);

  return { generated, test: !generated && isTestPath(file.path) };
};

/**
 * The test files "Hide tests" takes out of the list, the diff and Viewed progress: every
 * test file but those with a Finding, so hiding tests never hides risk.
 */
export const hideableTests = (
  files: ReadonlyArray<ReviewFile>,
  flagged: ReadonlyMap<string, unknown>
): ReadonlySet<string> =>
  new Set(files.flatMap((f) => (f.test && !flagged.has(f.file.path) ? [f.key] : [])));

/** Sections without the hidden files; a section left empty drops out. */
export const withoutFiles = (
  sections: ReadonlyArray<ReviewSection>,
  hidden: ReadonlySet<string>
): ReadonlyArray<ReviewSection> =>
  hidden.size === 0
    ? sections
    : sections.flatMap((section) => {
        const files = section.files.filter((f) => !hidden.has(f.key));

        return files.length === 0 ? [] : [{ ...section, files }];
      });

/** Whether `path` names one of the hidden files. */
export const isHiddenPath = (
  sections: ReadonlyArray<ReviewSection>,
  hidden: ReadonlySet<string>,
  path: string
): boolean => sections.some((s) => s.files.some((f) => f.file.path === path && hidden.has(f.key)));
