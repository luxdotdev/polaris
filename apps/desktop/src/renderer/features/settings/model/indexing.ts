/**
 * What Settings → Usage does with a `UsageChanged` (ENG-209, ADR 0009): a long
 * indexing pass is announced with `indexing` true and ends with `indexing`
 * false and no buckets, which means "query again"; a short pass lists its buckets.
 */
export type UsageChangeAction =
  /** A long pass started: show "Indexing usage…", query nothing yet. */
  | "indexing"
  /** The long pass ended: query again now. */
  | "requery-now"
  /** A short pass changed some buckets: query again after a quiet moment, so estimates stay attached. */
  | "requery-soon";

export const usageChangeAction = (change: {
  readonly indexing: boolean;
  readonly buckets: ReadonlyArray<unknown>;
}): UsageChangeAction => {
  if (change.indexing) return "indexing";

  return change.buckets.length === 0 ? "requery-now" : "requery-soon";
};
