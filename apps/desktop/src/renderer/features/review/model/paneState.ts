/**
 * What the diff pane shows for a ready Review: the diff, or a sentence saying why not.
 * It never shows an empty pane (UB diffview 1: a blank pane with no reason).
 */
import type { ReviewScale } from "./policy.ts";

export type PaneState =
  | { readonly kind: "diff" }
  | { readonly kind: "message"; readonly title: string; readonly fact: string };

export interface PaneInput {
  readonly files: number;
  /** Files with a parsed diff the pane can draw. */
  readonly items: number;
  readonly complete: boolean;
  readonly scale: ReviewScale;
}

export const paneState = ({ files, items, complete, scale }: PaneInput): PaneState => {
  if (items > 0) return { kind: "diff" };

  if (!complete) return { kind: "message", title: "Reading the diff…", fact: "" };

  if (files === 0) {
    return {
      kind: "message",
      title: "No changes",
      fact: "Nothing differs between these revisions",
    };
  }

  if (scale === "list-only") {
    return {
      kind: "message",
      title: "Pick a file",
      fact: "Open a file from the list to see its diff",
    };
  }

  return {
    kind: "message",
    title: "Couldn’t show this diff",
    fact: `${files.toLocaleString("en-US")} ${files === 1 ? "file" : "files"} changed, but none could be read`,
  };
};
