/**
 * ⌘F in a transcript: the list is virtualized, so the browser can't find in it.
 * This searches what was said, in folded Turns too: the user's prompts and steers
 * and the agent's replies. Commands, tool calls and their output stay out (owner, 2026-10-11).
 */
import type { TurnView } from "../../../store/sessionModel.ts";
import { groupRows, type Row } from "./conversation.ts";
import { groupTurns } from "./turnGroups.ts";

/** One occurrence: the row it is in, and which occurrence in that row's text. */
export interface Hit {
  readonly turnId: string;
  readonly rowKey: string;
  readonly occurrence: number;
}

export interface SearchOptions {
  readonly matchCase: boolean;
}

/** What a row shows that is searched: a prompt, a steer or a reply; nothing else. */
export const rowText = (row: Row): string => {
  if (row.kind === "prompt") return row.text;

  if (row.kind !== "item" || row.entry.kind !== "item") return "";
  const { item } = row.entry;

  return item.kind === "message" || item.kind === "user" ? item.text : "";
};

/** How many times `query` occurs in `text`, without overlaps. */
export const occurrences = (text: string, query: string, { matchCase }: SearchOptions) => {
  if (query === "") return 0;
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  let count = 0;

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    count++;
    at += needle.length - 1;
  }

  return count;
};

/** Every occurrence, in transcript order, across open and folded Turns. */
export const findInTranscript = (
  turns: ReadonlyArray<TurnView>,
  query: string,
  options: SearchOptions
): ReadonlyArray<Hit> => {
  if (query.trim() === "") return [];
  const hits: Array<Hit> = [];
  const groups = groupTurns(turns);
  const last = groups.length - 1;
  const lastTurnId = turns.at(-1)?.turn.id ?? null;

  // A hit names its shown Turn, so stepping to one in a Harness-started Turn opens the whole Turn.
  groups.forEach((group, n) => {
    for (const row of groupRows(group, true, n === last, lastTurnId)) {
      const count = occurrences(rowText(row), query, options);

      for (let occurrence = 0; occurrence < count; occurrence++)
        hits.push({ turnId: group.id, rowKey: row.key, occurrence });
    }
  });

  return hits;
};
