#!/usr/bin/env bun
/**
 * One Rules run over a change, for the bench (`packages/bench`, scenario
 * `rules`) and by hand:
 *
 *   bun apps/daemon/scripts/rules-run.ts <repo> <base> <head> <history|snapshot>
 *
 * Prints one JSON line: wall time, Findings by Severity and source, notes.
 */
import { runRules } from "../src/rules/run.ts";

const [cwd, base, head, mode] = process.argv.slice(2);

if (cwd === undefined || base === undefined || head === undefined) {
  console.error("usage: rules-run.ts <repo> <base> <head> <history|snapshot>");
  process.exit(2);
}

const started = performance.now();

const outcome = await runRules({
  cwd,
  base,
  head,
  mode: mode === "snapshot" ? "snapshot" : "history",
});

const ms = performance.now() - started;

const bySeverity: Record<string, number> = {};

for (const finding of outcome.findings) {
  bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
}

console.log(
  JSON.stringify({ ms, findings: outcome.findings.length, bySeverity, notes: outcome.notes })
);
