/**
 * The rows of the context pane's diff (D6): the focused file's diff with its findings inline, or
 * why the diff can't show above that file's findings, as Review's list does. Pure.
 */
import type { RiskFinding, RiskSummary } from "@polaris/protocol";
import { type DiffFileInput, type DiffRow, diffRows, reviewRows } from "../review/diffRows.ts";

/** The focused Turn's diff and its cached Risk Summary, which outlives a failed diff. */
export type TurnFiles =
  | { readonly kind: "loading" }
  | { readonly kind: "working" }
  | {
      readonly kind: "ready";
      readonly files: ReadonlyArray<DiffFileInput>;
      readonly summary: RiskSummary | null;
    }
  | { readonly kind: "failed"; readonly message: string; readonly summary: RiskSummary | null };

export const summaryOf = (files: TurnFiles): RiskSummary | null =>
  files.kind === "ready" || files.kind === "failed" ? files.summary : null;

const fileProblem = (files: TurnFiles, path: string): string | null => {
  switch (files.kind) {
    case "loading":
      return "Loading the diff…";
    case "working":
      return "The diff shows when this turn ends.";
    case "failed":
      return files.message;
    case "ready":
      return files.files.some((f) => f.diff.name === path)
        ? null
        : "This file has no changes left in this turn's diff.";
  }
};

/** Never empty of the file's findings: a missing file or failed diff becomes a note above them. */
export const contextRows = (
  files: TurnFiles,
  findings: ReadonlyArray<RiskFinding>,
  path: string | null
): ReadonlyArray<DiffRow> => {
  if (path === null)
    return [{ kind: "note", key: "n:problem", text: "This step changed no files." }];

  const mine = findings.filter((f) => f.path === path);
  const open = new Set([path]);
  const problem = fileProblem(files, path);

  if (problem !== null || files.kind !== "ready")
    return reviewRows({ files: [], problem, findings: mine, open, order: "path" });

  return diffRows(
    files.files.filter((f) => f.diff.name === path),
    mine,
    open
  );
};
