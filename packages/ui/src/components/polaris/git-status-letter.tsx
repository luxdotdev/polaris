import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export type GitStatus =
  | "modified"
  | "added"
  | "untracked"
  | "deleted"
  | "renamed"
  | "conflicted"
  | "ignored";

export const GIT_STATUSES: readonly GitStatus[] = [
  "modified",
  "added",
  "untracked",
  "deleted",
  "renamed",
  "conflicted",
  "ignored",
];

/** rule/git-is-a-letter: M, A, U, D, R, C; ignored has no letter. */
export const GIT_LETTERS: Record<GitStatus, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
  deleted: "D",
  renamed: "R",
  conflicted: "C",
  ignored: "",
};

/** The tint for the letter and the file name beside it. */
export const GIT_TINTS: Record<GitStatus, string> = {
  modified: "text-git-modified",
  added: "text-diff-added",
  untracked: "text-diff-added",
  deleted: "text-diff-removed",
  renamed: "text-git-modified",
  conflicted: "text-diff-removed",
  ignored: "text-text-faint",
};

export interface GitStatusLetterProps extends HTMLAttributes<HTMLSpanElement> {
  readonly status: GitStatus;
}

/** A git status as its letter in a fixed 16px slot; never a dot or icon alone. */
export function GitStatusLetter({ status, className, ...props }: GitStatusLetterProps) {
  return (
    <span
      data-slot="git-status"
      data-status={status}
      title={status}
      className={cn(
        "inline-flex w-4 shrink-0 justify-center font-mono text-code-inline font-medium",
        GIT_TINTS[status],
        className
      )}
      {...props}
    >
      {GIT_LETTERS[status]}
    </span>
  );
}
