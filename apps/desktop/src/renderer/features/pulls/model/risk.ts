/**
 * The risk lane (DESIGN.md Review → Pull requests): the highest Severity among a cached Risk
 * Summary's open Findings with how many share it, or "Not run" when none is cached. The list
 * never implies a change is safe, so a summary with no open Findings says only that.
 */
import type { Severity } from "@polaris/protocol";

export type RiskLane =
  | { readonly kind: "not-run" }
  | { readonly kind: "running" }
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly severity: Severity; readonly count: number };

export const NOT_RUN: RiskLane = { kind: "not-run" };

/** What the lane needs of a summary (`RiskSummary`). */
export interface SummaryFacts {
  readonly status: string;
  readonly findings: ReadonlyArray<{ readonly severity: Severity; readonly status: string }>;
}

const ORDER: ReadonlyArray<Severity> = ["critical", "high", "medium", "low"];

export const laneOf = (summary: SummaryFacts | null): RiskLane => {
  if (summary === null) return NOT_RUN;

  const open = summary.findings.filter((f) => f.status === "open");
  const severity = ORDER.find((s) => open.some((f) => f.severity === s));

  if (severity !== undefined) {
    return { kind: "found", severity, count: open.filter((f) => f.severity === severity).length };
  }

  if (summary.status === "completed") return { kind: "none" };

  return summary.status === "running" ? { kind: "running" } : NOT_RUN;
};

/** A pull request's key across the list, Review Checkouts and Risk Summaries. */
export const pullKey = (owner: string, name: string, number: number) =>
  `${owner}/${name}#${number}`.toLowerCase();
