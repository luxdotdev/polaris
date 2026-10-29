/**
 * The `@` picker's rows for the word being typed: asked of the search per
 * query, an answer to an older query dropped. The last rows stay up while the
 * next query is read, so the list doesn't blink between keystrokes.
 */
import { useEffect, useState } from "react";
import type { TypedWord } from "../editor/state.ts";
import { type MentionRow, mentionRows, type MentionSearch } from "../model/mentions.ts";

export interface MentionResults {
  /** The query these rows answer; null before the first answer. */
  readonly query: string | null;
  readonly rows: ReadonlyArray<MentionRow>;
  readonly failed: string | null;
}

const NONE: MentionResults = { query: null, rows: [], failed: null };

/** Whether the picker shows: reading its first answer, with rows, or saying why it can't. */
export const showsResults = (results: MentionResults) =>
  results.query === null || results.rows.length > 0 || results.failed !== null;

const useMentionResults = (search: MentionSearch | null, query: string | null): MentionResults => {
  const [results, setResults] = useState<MentionResults>(NONE);

  useEffect(() => {
    if (search === null || query === null) return undefined;
    let current = true;

    void search(query).then(({ paths, failed }) => {
      if (current) setResults({ query, rows: mentionRows(query, paths), failed });
    });

    return () => {
      current = false;
    };
  }, [search, query]);

  return search === null || query === null ? NONE : results;
};

/** The picker for the typed word: open on an `@` word that esc hasn't closed, where search exists. */
export const useMentionPicker = (
  search: MentionSearch | null,
  typed: TypedWord | null,
  dismissed: string | null,
  index: number
) => {
  const query =
    search !== null && typed?.sigil === "@" && typed.word !== dismissed ? typed.query : null;

  const results = useMentionResults(search, query);

  return {
    results,
    shown: query !== null && showsResults(results),
    active: Math.min(index, Math.max(0, results.rows.length - 1)),
  };
};
