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
  /** Rules ran but the Reviewer didn't (asking first, switched off, failed): no open Finding yet. */
  | { readonly kind: "rules-only" }
  | { readonly kind: "found"; readonly severity: Severity; readonly count: number };

export const NOT_RUN: RiskLane = { kind: "not-run" };

/** What the lane needs of a summary (`RiskSummary`). */
export interface SummaryFacts {
  readonly status: string;
  readonly layers?: { readonly agent: { readonly status: string } };
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

  if (summary.status === "completed") {
    return summary.layers === undefined || summary.layers.agent.status === "completed"
      ? { kind: "none" }
      : { kind: "rules-only" };
  }

  return summary.status === "running" ? { kind: "running" } : NOT_RUN;
};

/** A pull request's Review subject key part (`owner/name#n`), as `subjectKey` spells it. */
export const pullKey = (owner: string, name: string, number: number) =>
  `${owner}/${name}#${number}`.toLowerCase();

/** A pull request across Hosts' Review Checkouts: its code host too (GitHub Enterprise). */
export const checkoutKey = (host: string, owner: string, name: string, number: number) =>
  `${host}/${owner}/${name}#${number}`.toLowerCase();
