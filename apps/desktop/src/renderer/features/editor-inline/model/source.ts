/**
 * ⌘L's pure parts: the selected lines as a source in a session's draft (a path, the range
 * and a fenced copy of the text, unsaved edits included), and which session it goes to by
 * default: the one last focused in this Workspace.
 */
import { rangeLabel } from "./patch.ts";

export interface SelectedSource {
  /** As shown to the agent: relative to the Workspace when inside it. */
  readonly path: string;
  readonly first: number;
  readonly last: number;
  readonly text: string;
}

const longestRun = (text: string, char: string) => {
  let longest = 0;
  let run = 0;

  for (const c of text) {
    run = c === char ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  return longest;
};

/** The source as Markdown: a fence longer than any backtick run inside it. */
export const sourceBlock = (source: SelectedSource): string => {
  const fence = "`".repeat(Math.max(3, longestRun(source.text, "`") + 1));
  const dot = source.path.lastIndexOf(".");
  const info = dot > source.path.lastIndexOf("/") ? source.path.slice(dot + 1) : "";
  const body = source.text.endsWith("\n") ? source.text : `${source.text}\n`;

  return `\`${source.path}\` ${rangeLabel(source.first, source.last)}:\n${fence}${info}\n${body}${fence}\n`;
};

/** The draft with the block after what's already there, a blank line apart. */
export const withSource = (draft: string, block: string): string =>
  draft.trim() === "" ? block : `${draft.trimEnd()}\n\n${block}`;

export interface TargetSession {
  readonly id: string;
  readonly updatedAt: string;
}

/** Sessions in pick order: the default (the last focused) first, then most recently active. */
export const targetOrder = <S extends TargetSession>(
  sessions: ReadonlyArray<S>,
  lastFocused: string | null
): Array<S> =>
  [...sessions].sort((a, b) => {
    if (a.id === lastFocused) return -1;

    if (b.id === lastFocused) return 1;

    return b.updatedAt.localeCompare(a.updatedAt);
  });
