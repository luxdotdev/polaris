/** Sweep layout and post-processing knobs; recorded replays pin the options they were made with. */
export interface SweepOptions {
  /** Window lines above and below the focus line. */
  readonly above: number;
  readonly below: number;
  /** File lines before the window, as the leading `<|file_sep|>` block. */
  readonly prefixLines: number;
  /** Unchanged lines around each history `.diff` block (the card uses 1). */
  readonly historyContext: number;
  /** The most recent hunk also as a `.diff` block; `original/` always shows it. */
  readonly lastAsDiff: boolean;
  readonly historyLimit: number;
  /** Show the change nearest the focus when the whole rewrite is suppressed. */
  readonly nearestFallback: boolean;
  /** Suppress edits that use a name the buffer, history and path never mention. */
  readonly novelNames: boolean;
  /** Suppress renaming an existing declaration other than the one being typed. */
  readonly declarationRenames: boolean;
  /** Suppress bringing back, off the cursor line, a name the history removed. */
  readonly removedNames: boolean;
  /** Suppress whole-line deletions the history gives no reason for. */
  readonly deletionEvidence: boolean;
  /** Suppress changes away from the focus line that touch no word of the history. */
  readonly relevance: boolean;
  /** Suppress a line repeating its neighbour and a name redeclared within two lines. */
  readonly duplicates: boolean;
}

/** The layout of the spike and the 2026-10-15 hardening recordings. */
export const spikeSweepOptions: SweepOptions = {
  above: 10,
  below: 10,
  prefixLines: 80,
  historyContext: 0,
  lastAsDiff: true,
  historyLimit: 32,
  nearestFallback: false,
  novelNames: false,
  declarationRenames: false,
  removedNames: false,
  deletionEvidence: false,
  relevance: false,
  duplicates: false,
};

export const sweepOptions: SweepOptions = spikeSweepOptions;
