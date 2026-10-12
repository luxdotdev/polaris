/**
 * When a finished command folds its output to the header line: once it has
 * succeeded and a moment has passed (at once for one already done when shown),
 * never while it runs or when it failed, nor while its Turn is the latest. The
 * user's own open or close wins, and is kept while the row scrolls out of the
 * virtualized list and back.
 */
export const COLLAPSE_DELAY_MS = 2000;

export interface CollapseInput {
  readonly running: boolean;
  readonly failed: boolean;
  /** The delay after finishing has passed, or it was already done when it mounted. */
  readonly settled: boolean;
  /** What the user chose with the disclosure; null when they haven't. */
  readonly choice: boolean | null;
  /** Its Turn is the latest, which stays fully open until the user folds it. */
  readonly latest?: boolean;
}

/** Whether the output shows. */
export const outputOpen = ({
  running,
  failed,
  settled,
  choice,
  latest,
}: CollapseInput): boolean => {
  if (choice !== null) return choice;

  return running || failed || !settled || latest === true;
};

const choices = new Map<string, boolean>();

/** The user's choice for an item (by its row key); null when they haven't made one. */
export const collapseChoice = (key: string): boolean | null => choices.get(key) ?? null;

export const chooseCollapse = (key: string, open: boolean) => {
  choices.set(key, open);
};

/**
 * A row's open state when first shown: the user's choice, else open in the latest Turn. Open
 * there is kept as if chosen, so a newer Turn never folds what is being read.
 */
export const initialOpen = (key: string, latest: boolean): boolean => {
  const choice = collapseChoice(key);

  if (choice !== null) return choice;

  if (latest) chooseCollapse(key, true);

  return latest;
};
