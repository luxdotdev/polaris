/**
 * The bench Harness drafting an accept's commit message: it answers the JSON asked for,
 * titled from the stat's first file, so the smoke and tests take the Harness's path.
 */
import { ACCEPT_DRAFT_MARKER } from "../../accept/draft.ts";

export const isAcceptDraftPrompt = (prompt: string): boolean =>
  prompt.includes(ACCEPT_DRAFT_MARKER);

export const benchDraftReply = (prompt: string): string => {
  const turns = Number(/(\d+) commit titles/.exec(prompt)?.[1] ?? "1");

  return JSON.stringify({
    title: "Update the bench files",
    body: "Written by the bench Harness.",
    prTitle: "Update the bench files",
    prBody: "Drafted by the bench Harness for the smoke test.",
    turnTitles: Array.from({ length: turns }, (_, i) => `Update the bench files, part ${i + 1}`),
  });
};
