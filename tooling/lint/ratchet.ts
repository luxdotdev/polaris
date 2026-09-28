#!/usr/bin/env bun
/**
 * The lint ratchet: oxlint with a committed baseline of existing violations.
 *
 *   bun tooling/lint/ratchet.ts [files…]                   fail on new or increased violations
 *   bun tooling/lint/ratchet.ts --update-baseline [files…]  also lower the baseline to what's left
 *   bun tooling/lint/ratchet.ts --rebaseline                record every current violation (new rules only)
 *
 * Without files it lints the whole repo. See packages/lint-config/README.md for the policy.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Schema } from "effect";
import {
  BaselineFile,
  type Counts,
  compare,
  countViolations,
  type Delta,
  tighten,
  type Violation,
} from "./baseline.ts";
import { LINTABLE, ROOT, runOxlint } from "./oxlint.ts";

const BASELINE = join(ROOT, "tooling/lint/baseline.json");

const COMMENT =
  "Existing lint violations, per file and rule. `bun run lint` fails when a count goes up; `bun run lint:baseline` lowers them. Never raise a count by hand: fix the code. See packages/lint-config/README.md.";

const decodeBaseline = Schema.decodeUnknownSync(Schema.fromJsonString(BaselineFile));

const readBaseline = (): Counts =>
  existsSync(BASELINE) ? decodeBaseline(readFileSync(BASELINE, "utf8")).violations : {};

const writeBaseline = (violations: Counts) => {
  const file: BaselineFile = { $comment: COMMENT, violations };

  writeFileSync(BASELINE, `${JSON.stringify(file, null, 2)}\n`);
};

const toRepoPath = (file: string) =>
  relative(ROOT, isAbsolute(file) ? file : resolve(process.cwd(), file));

const describeDelta = (d: Delta, violations: ReadonlyArray<Violation>) => {
  const where = violations.flatMap((v) =>
    v.file === d.file && v.rule === d.rule
      ? [`    ${v.file}:${v.line}:${v.column}  ${v.message}`]
      : []
  );

  return [`  ${d.file}  ${d.rule}: ${d.current} (baseline ${d.baseline})`, ...where].join("\n");
};

const report = (regressions: ReadonlyArray<Delta>, violations: ReadonlyArray<Violation>) => {
  console.error(
    `Lint: ${regressions.length} new or increased violation(s). Fix them; don't raise the baseline.\n`
  );
  console.error(regressions.map((d) => describeDelta(d, violations)).join("\n\n"));
};

const main = () => {
  const args = process.argv.slice(2);
  const update = args.includes("--update-baseline");
  const requested = args.filter((a) => !a.startsWith("--")).map(toRepoPath);
  const files = requested.filter((f) => LINTABLE.test(f) && existsSync(join(ROOT, f)));

  if (requested.length > 0 && files.length === 0) return 0;

  const violations = runOxlint(files);
  const current = countViolations(violations);

  if (args.includes("--rebaseline")) {
    writeBaseline(current);
    console.log(`Recorded ${violations.length} violations in ${relative(ROOT, BASELINE)}.`);

    return 0;
  }

  const scope = files.length > 0 ? new Set(files) : null;
  const baseline = readBaseline();
  const { regressions, improvements } = compare(baseline, current, scope);

  if (update && improvements.length > 0) writeBaseline(tighten(baseline, current, scope));

  if (improvements.length > 0) {
    const fixed = improvements.reduce((n, d) => n + d.baseline - d.current, 0);

    const hint = update
      ? "Baseline lowered; commit it."
      : "Run `bun run lint:baseline` to lock it in.";

    console.log(`Lint: ${fixed} baselined violation(s) fixed. ${hint}`);
  }

  if (regressions.length === 0) return 0;

  report(regressions, violations);

  return 1;
};

process.exit(main());
