/**
 * "When it runs" and "Ask first for large changes" (Settings → Reviewer,
 * DESIGN.md S7): whether a Risk Summary's Reviewer runs now. The Rules always
 * run; a summary the user asked for (`refresh`) runs the Reviewer regardless.
 */
import { type ReviewerSettings, ReviewSubject } from "@polaris/protocol";
import type { ChangeDiff } from "./diff.ts";

const count = new Intl.NumberFormat("en-US");

/** Why the Reviewer is switched off for this subject, or null when it runs. */
export const switchedOff = (
  subject: ReviewSubject,
  settings: ReviewerSettings,
  refresh: boolean
): string | null => {
  if (refresh) return null;

  return ReviewSubject.match(subject, {
    PullRequest: () =>
      settings.onPullRequests
        ? null
        : "The Reviewer doesn't run on pull requests by itself (Settings → Reviewer). Run reviewer to review this one.",
    SessionTurns: () =>
      settings.onSessions
        ? null
        : "The Reviewer doesn't run on agent sessions by itself (Settings → Reviewer). Run reviewer to review this one.",
  });
};

/** Lines added and removed across the diff. */
export const changedLines = (diff: ChangeDiff): number => {
  let lines = 0;

  for (const file of diff.files) {
    for (const line of file.patch.split("\n")) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;

      if (line.startsWith("+") || line.startsWith("-")) lines += 1;
    }
  }

  return lines;
};

/** The note when the change is over the "Ask first" threshold, else null. */
export const askFirst = (lines: number, askAboveLines: number | null): string | null =>
  askAboveLines === null || lines <= askAboveLines
    ? null
    : `${count.format(lines)} changed lines is over ${count.format(askAboveLines)}: the rules ran, and the Reviewer waits for Run reviewer.`;
