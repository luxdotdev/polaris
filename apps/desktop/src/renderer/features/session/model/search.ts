/**
 * ⌘F in a transcript: the list is virtualized, so the browser can't find in it.
 * This searches the text each row shows when its Turn is open (prompts, replies,
 * steers, command lines, tool calls, paths, plans, Subagents), folded Turns too.
 * Command output and thinking stay out: they are collapsed, so a hit would show nothing.
 */
import type { TurnView } from "../../../store/sessionModel.ts";
import { type Row, turnRows } from "./conversation.ts";
import type { ItemView } from "./items.ts";
import type { Entry } from "./runs.ts";

/** One occurrence: the row it is in, and which occurrence in that row's text. */
export interface Hit {
  readonly turnId: string;
  readonly rowKey: string;
  readonly occurrence: number;
}

export interface SearchOptions {
  readonly matchCase: boolean;
}

const itemText = (item: ItemView): ReadonlyArray<string> => {
  switch (item.kind) {
    case "message":
    case "user":
      return [item.text];
    case "command":
      return [item.command];
    case "tool":
      return [item.name, item.summary];
    case "files":
      return item.changes.map((c) => c.path);
    case "plan":
      return [item.explanation ?? "", ...item.steps.map((s) => s.text)];
    case "error":
      return [item.message];
    case "reasoning":
      return [];
  }
};

const entryText = (entry: Entry): ReadonlyArray<string> => {
  switch (entry.kind) {
    case "item":
      return itemText(entry.item);
    case "run":
      return [entry.summary];
    case "subagent":
      return [entry.card.subagent.title, entry.card.task ?? "", entry.card.report ?? ""];
  }
};

/** What a row shows, as searchable text; empty for rows with nothing to find. */
export const rowText = (row: Row): string => {
  switch (row.kind) {
    case "prompt":
    case "trigger":
      return row.text;
    case "item":
      return entryText(row.entry)
        .filter((t) => t !== "")
        .join("\n");
    default:
      return "";
  }
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
  const last = turns.length - 1;

  turns.forEach((view, n) => {
    for (const row of turnRows(view, true, n === last)) {
      const count = occurrences(rowText(row), query, options);

      for (let occurrence = 0; occurrence < count; occurrence++)
        hits.push({ turnId: view.turn.id, rowKey: row.key, occurrence });
    }
  });

  return hits;
};
