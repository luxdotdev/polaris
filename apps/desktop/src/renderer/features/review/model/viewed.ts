/**
 * Viewed marks (DESIGN.md, Review): Polaris state per Review subject and file. A mark holds
 * the file's diff fingerprint, so a file whose diff changed reads as not viewed again. For a
 * pull request GitHub's state is the truth (`viewed`, `unviewed`, `dismissed`: viewed, then
 * changed); the user's own clicks override it until GitHub agrees.
 */

/** Marks by subject key, then file key → fingerprint; subjects most recent last. */
export interface ViewedBook {
  readonly subjects: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly order: ReadonlyArray<string>;
}

export const emptyBook: ViewedBook = { subjects: {}, order: [] };

/** How many subjects the book remembers. */
export const KEPT_SUBJECTS = 60;

export const isViewed = (book: ViewedBook, subject: string, file: string, fingerprint: string) =>
  book.subjects[subject]?.[file] === fingerprint;

/** Marks or clears a file; `fingerprint` null clears it. */
export const setViewed = (
  book: ViewedBook,
  subject: string,
  file: string,
  fingerprint: string | null
): ViewedBook => {
  const marks = { ...book.subjects[subject] };

  if (fingerprint === null) delete marks[file];
  else marks[file] = fingerprint;

  const order = [...book.order.filter((s) => s !== subject), subject];
  const dropped = order.slice(0, Math.max(0, order.length - KEPT_SUBJECTS));

  const subjects = { ...book.subjects, [subject]: marks } satisfies ViewedBook["subjects"];

  for (const old of dropped) delete subjects[old];

  return { subjects, order: order.slice(dropped.length) };
};

/** GitHub's Viewed state for a pull request's file (`PullFileView.viewed`). */
export type RemoteViewed = "viewed" | "unviewed" | "dismissed";

/** A pull request's file: the user's pending click wins, then GitHub. */
export const pullFileViewed = (remote: RemoteViewed | undefined, pending: boolean | undefined) =>
  pending ?? remote === "viewed";

export interface ViewedProgress {
  readonly viewed: number;
  readonly total: number;
  /** "3 of 7 viewed". */
  readonly label: string;
  /** 0–1 for the progress bar. */
  readonly fraction: number;
}

export const progressOf = (viewed: number, total: number): ViewedProgress => ({
  viewed,
  total,
  label: `${viewed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} viewed`,
  fraction: total === 0 ? 0 : viewed / total,
});
