/**
 * The bench Harness as a Reviewer: a Reviewer prompt gets schema output, so
 * benchmarks, tests and the smoke run a Risk Summary end to end without
 * tokens. The review flags the first added line of the diff it was given; a
 * follow-up answers, and withdraws the Finding it names when asked to.
 */
import { isTestPath } from "@polaris/protocol";
import type { ReviewerOutput } from "../../reviewer/output.ts";
import { WALKTHROUGH_MARKER } from "../../reviewer/walkthroughPrompt.ts";
import { REVIEWER_MARKER } from "../../reviewer/prompt.ts";

export const isReviewerPrompt = (prompt: string): boolean =>
  prompt.startsWith(REVIEWER_MARKER) || prompt.startsWith(WALKTHROUGH_MARKER);

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

const benchGroup = (key: string, label: string, category: string, paths: ReadonlyArray<string>) =>
  paths.length === 0
    ? []
    : [
        {
          key,
          label,
          summary: `The bench groups ${label.toLowerCase()} by path.`,
          category,
          critical: false,
          paths,
        },
      ];

/** Intent groups by path for every file the prompt's changed-files list names. */
const benchGroups = (prompt: string) => {
  const listed = [...prompt.matchAll(/^[A-Z]\S* (.+?) \+\d+ -\d+((?: \[\w+\])*)$/gm)];

  const pathsWhere = (generated: boolean) =>
    listed.flatMap((m) => (m[2]?.includes("[generated]") === generated ? [m[1] ?? ""] : []));

  const generated = pathsWhere(true);
  const rest = pathsWhere(false);
  const tests = rest.filter(isTestPath);
  const docs = rest.filter((p) => !isTestPath(p) && p.endsWith(".md"));
  const code = rest.filter((p) => !isTestPath(p) && !p.endsWith(".md"));

  const groups = [
    ...benchGroup("change", "The change", "core", code),
    ...benchGroup("tests", "Its tests", "tests", tests),
    ...benchGroup("docs", "Docs", "docs", docs),
    ...benchGroup("generated", "Lockfiles", "deps", generated),
  ];

  return `## Intent groups\n\`\`\`json\n${JSON.stringify({ groups })}\n\`\`\``;
};

export const benchReviewReply = (prompt: string): string => {
  if (prompt.startsWith(WALKTHROUGH_MARKER))
    return `## Why the change\nThis change makes the behavior shown in the diff possible.\n\n## Special things to note\n- Check the changed paths before accepting.\n\n## Change outline\n\`\`\`diff\n- previous behavior\n+ behavior in the composed diff\n\`\`\`\n\n${benchGroups(prompt)}`;

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
