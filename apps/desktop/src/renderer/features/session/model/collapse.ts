/**
 * When a finished command folds its output to the header line: once it has
 * succeeded and a moment has passed (at once for one already done when shown),
 * never while it runs or when it failed. The user's own open or close wins,
 * and is kept while the row scrolls out of the virtualized list and back.
 */
export const COLLAPSE_DELAY_MS = 2000;

export interface CollapseInput {
  readonly running: boolean;
  readonly failed: boolean;
  /** The delay after finishing has passed, or it was already done when it mounted. */
  readonly settled: boolean;
  /** What the user chose with the disclosure; null when they haven't. */
  readonly choice: boolean | null;
}

/** Whether the output shows. */
export const outputOpen = ({ running, failed, settled, choice }: CollapseInput): boolean => {
  if (choice !== null) return choice;

  return running || failed || !settled;
};

const choices = new Map<string, boolean>();

/** The user's choice for an item (by its row key); null when they haven't made one. */
export const collapseChoice = (key: string): boolean | null => choices.get(key) ?? null;

export const chooseCollapse = (key: string, open: boolean) => {
  choices.set(key, open);
};
