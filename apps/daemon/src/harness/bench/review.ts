/**
 * The bench Harness as a Reviewer: a Reviewer prompt gets schema output, so
 * benchmarks, tests and the smoke run a Risk Summary end to end without
 * tokens. The review flags the first added line of the diff it was given; a
 * follow-up answers, and withdraws the Finding it names when asked to.
 */
import type { ReviewerOutput } from "../../reviewer/output.ts";
import { REVIEWER_MARKER } from "../../reviewer/prompt.ts";

export const isReviewerPrompt = (prompt: string): boolean => prompt.startsWith(REVIEWER_MARKER);

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The first added line in the prompt's diff: its file at head and line number. */
export const firstAddedLine = (prompt: string): { path: string; line: number } | null => {
  let path: string | null = null;
  let line = 0;

  for (const text of prompt.split("\n")) {
    if (text.startsWith("+++ ")) {
      path = text === "+++ /dev/null" ? null : text.slice(4).replace(/^b\//, "");
      continue;
    }

    const hunk = HUNK.exec(text);

    if (hunk !== null) {
      line = Number(hunk[1]);
      continue;
    }

    if (path === null || line === 0) continue;

    if (text.startsWith("+")) return { path, line };

    if (!text.startsWith("-")) line += 1;
  }

  return null;
};

const fenced = (document: ReviewerOutput) =>
  `Done.\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\``;

const empty: ReviewerOutput = { findings: [], revised: [], withdrawn: [], answer: null };

export const benchReviewReply = (prompt: string): string => {
  if (prompt.includes("couldn't be read")) return fenced(empty);

  if (prompt.includes("A question about")) {
    const named = /\[(agent-[0-9a-f]+)\]/.exec(prompt)?.[1];
    const withdraw = named !== undefined && /withdraw/i.test(prompt);

    return fenced({
      ...empty,
      answer: "The bench Reviewer has looked again.",
      withdrawn: withdraw ? [{ findingId: named, note: "Withdrawn on request." }] : [],
    });
  }

  const added = firstAddedLine(prompt);

  return fenced({
    ...empty,
    findings:
      added === null
        ? []
        : [
            {
              path: added.path,
              startLine: added.line,
              endLine: added.line,
              side: "new",
              severity: "medium",
              confidence: 0.7,
              title: "Bench: check this line",
              reason: "The bench Reviewer flags the first added line of every change.",
              suggestion: null,
            },
          ],
  });
};
