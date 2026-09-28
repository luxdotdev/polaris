import { Schema } from "effect"

/** Violation counts per file, then per rule. Only files and rules with a count above zero appear. */
export const Counts = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number))

export type Counts = typeof Counts.Type

export const BaselineFile = Schema.Struct({
  $comment: Schema.String,
  violations: Counts,
})

export type BaselineFile = typeof BaselineFile.Type

export interface Violation {
  readonly file: string
  readonly rule: string
  readonly line: number
  readonly column: number
  readonly message: string
}

/** One file and rule whose count differs from the baseline. */
export interface Delta {
  readonly file: string
  readonly rule: string
  readonly baseline: number
  readonly current: number
}

/** Regressions are new or increased counts; improvements are counts that dropped. */
export interface Comparison {
  readonly regressions: ReadonlyArray<Delta>
  readonly improvements: ReadonlyArray<Delta>
}

export const countViolations = (violations: ReadonlyArray<Violation>): Counts => {
  const counts = new Map<string, Map<string, number>>()

  for (const { file, rule } of violations) {
    const byRule = counts.get(file) ?? new Map<string, number>()

    byRule.set(rule, (byRule.get(rule) ?? 0) + 1)
    counts.set(file, byRule)
  }

  return toCounts(counts)
}

const toCounts = (counts: ReadonlyMap<string, ReadonlyMap<string, number>>): Counts =>
  Object.fromEntries(
    [...counts.entries()]
      .flatMap(([file, byRule]) => {
        const rules = sortedRules(byRule)

        return Object.keys(rules).length > 0 ? [[file, rules] as const] : []
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  )

const sortedRules = (byRule: ReadonlyMap<string, number>) =>
  Object.fromEntries(
    [...byRule.entries()].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)),
  )

const countOf = (counts: Counts, file: string, rule: string): number => counts[file]?.[rule] ?? 0

const keysOf = (counts: Counts) =>
  Object.entries(counts).flatMap(([file, byRule]) =>
    Object.keys(byRule).map((rule) => ({ file, rule })),
  )

/**
 * Compares current counts with the baseline for the files in scope (every file when
 * `scope` is null). Regressions are new or increased counts; improvements are drops.
 */
export const compare = (
  baseline: Counts,
  current: Counts,
  scope: ReadonlySet<string> | null,
): Comparison => {
  const deltas = (from: Counts) =>
    keysOf(from).flatMap(({ file, rule }) =>
      scope === null || scope.has(file)
        ? [
            {
              file,
              rule,
              baseline: countOf(baseline, file, rule),
              current: countOf(current, file, rule),
            },
          ]
        : [],
    )

  return {
    regressions: deltas(current).filter((d) => d.current > d.baseline),
    improvements: deltas(baseline).filter((d) => d.current < d.baseline),
  }
}

/**
 * Lowers baseline counts to the current ones for the files in scope. Never raises a
 * count or adds a file or rule: the baseline only ever tightens.
 */
export const tighten = (
  baseline: Counts,
  current: Counts,
  scope: ReadonlySet<string> | null,
): Counts => {
  const next = new Map<string, Map<string, number>>()

  for (const { file, rule } of keysOf(baseline)) {
    const allowed = countOf(baseline, file, rule)
    const inScope = scope === null || scope.has(file)
    const count = inScope ? Math.min(allowed, countOf(current, file, rule)) : allowed
    const byRule = next.get(file) ?? new Map<string, number>()

    byRule.set(rule, count)
    next.set(file, byRule)
  }

  return toCounts(next)
}
