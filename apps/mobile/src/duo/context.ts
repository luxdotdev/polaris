/**
 * What the unfolded Duo's second half shows (D6): the Turn, file and finding the first half is
 * about. A tapped step or finding decides it; until then, the latest Turn's file with an open
 * Critical finding, else its last edited file. Pure; `ContextPane` renders it.
 */
import type { RiskFinding, Severity } from "@polaris/protocol";
import { fileSeverities, highest, listedFindings } from "../review/model.ts";
import type { TurnEntry } from "../thread/fold.ts";
import type { ThreadFocus } from "../thread/Row.tsx";
import { type StepRow, turnSteps } from "../thread/rows.ts";

export interface OtherFile {
  readonly path: string;
  readonly severity: Severity | null;
}

export interface TurnContext {
  readonly turnId: string;
  /** "From turn 24", one-based as the thread numbers Turns. */
  readonly turnNumber: number;
  readonly working: boolean;
  /** The focused step's own words ("Edited serve.ts"), or the finding's title. */
  readonly label: string;
  /** The row the first half marks as focused. */
  readonly focusKey: string;
  /** The file the second half opens; null for a step that touched none. */
  readonly path: string | null;
  /** The most severe listed finding on that file. */
  readonly finding: RiskFinding | null;
  /** "Also in turn 24": the Turn's other files. */
  readonly also: ReadonlyArray<OtherFile>;
}

const pathsOf = (steps: ReadonlyArray<StepRow>): ReadonlyArray<string> => [
  ...new Set(steps.flatMap((step) => step.paths)),
];

const criticalOn = (findings: ReadonlyArray<RiskFinding>, path: string) =>
  fileSeverities(findings, path).includes("critical");

/** The step a fresh unfold opens on: a file with an open Critical, else the last file touched. */
const defaultStep = (
  turns: ReadonlyArray<TurnEntry>,
  findings: ReadonlyArray<RiskFinding>
): { readonly entry: TurnEntry; readonly step: StepRow } | null => {
  for (const entry of [...turns].reverse()) {
    const touched = turnSteps(entry).filter((step) => step.paths.length > 0);

    const step =
      touched.find((s) => s.paths.some((path) => criticalOn(findings, path))) ?? touched.at(-1);

    if (step !== undefined) return { entry, step };
  }

  return null;
};

const contextFor = (
  entry: TurnEntry,
  findings: ReadonlyArray<RiskFinding>,
  focus: Pick<ThreadFocus, "key" | "label" | "paths">
): TurnContext => {
  const path = focus.paths[0] ?? null;
  const listed = listedFindings(findings);

  return {
    turnId: entry.turn.id,
    turnNumber: entry.turn.userTurnNumber ?? entry.turn.index + 1,
    working: entry.turn.status === "working",
    label: focus.label,
    focusKey: focus.key,
    path,
    finding: path === null ? null : (listed.find((f) => f.path === path) ?? null),
    also: pathsOf(turnSteps(entry))
      .filter((other) => other !== path)
      .map((other) => ({ path: other, severity: highest(fileSeverities(findings, other)) })),
  };
};

export const contextOf = (
  turns: ReadonlyArray<TurnEntry>,
  findings: ReadonlyArray<RiskFinding>,
  focus: ThreadFocus | null
): TurnContext | null => {
  const focused = focus === null ? undefined : turns.find((e) => e.turn.id === focus.turnId);

  if (focus !== null && focused !== undefined) return contextFor(focused, findings, focus);

  const fallback = defaultStep(turns, findings);

  return fallback === null ? null : contextFor(fallback.entry, findings, fallback.step);
};
