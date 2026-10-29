/** A task's state as its star draws it (DESIGN.md, Star states). */
export type StarState = "done" | "working" | "review" | "blocked" | "failed" | "waiting";

/** One task of a constellation as a star: labelled band letter plus wave number ("B3"). */
export interface StarTask {
  readonly id: string;
  readonly label: string;
  /** The band's id, matching a `StarBand`. */
  readonly band: string;
  readonly wave: number;
  readonly state: StarState;
}

/** A band row of the chart, with its badge. */
export interface StarBand {
  readonly id: string;
  /** The badge letter, e.g. "B". */
  readonly letter: string;
  readonly name: string;
}

export interface StarChartProps {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly bands: ReadonlyArray<StarBand>;
  /** Draw the tasks as dots (MX-X); the chart chooses it past about 30 tasks when omitted. */
  readonly compact?: boolean;
  readonly selectedTaskId?: string | null;
  readonly onPressTask?: (taskId: string) => void;
}
