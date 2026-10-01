/**
 * How much of a Review's diff the view renders at once (ENG-230). Past 2,000 files or
 * 20 MB of patch every file opens collapsed and only expanded files are highlighted;
 * past 10,000 files the view lists files and opens them one at a time.
 */

/** `full`: every file expanded. `collapsed`: every file collapsed. `list-only`: one file at a time. */
export type ReviewScale = "full" | "collapsed" | "list-only";

export const COLLAPSE_FILES = 2000;

export const COLLAPSE_BYTES = 20 * 1024 * 1024;

export const LIST_ONLY_FILES = 10_000;

/** Patches past this parse in a worker, so the main thread keeps its frames. */
export const WORKER_PARSE_BYTES = 512 * 1024;

export const scaleOf = (files: number, bytes: number): ReviewScale => {
  if (files > LIST_ONLY_FILES) return "list-only";

  if (files > COLLAPSE_FILES || bytes > COLLAPSE_BYTES) return "collapsed";

  return "full";
};

/** What the view says about a large Review, under the file list; null at full scale. */
export const scaleNotice = (scale: ReviewScale, files: number): string | null => {
  if (scale === "list-only") {
    return `${files.toLocaleString("en-US")} files: open one from the list to see its diff`;
  }

  if (scale === "collapsed") {
    return `${files.toLocaleString("en-US")} files: each opens collapsed`;
  }

  return null;
};
