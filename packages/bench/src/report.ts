/** Human-readable output: terminal tables and Markdown (for $GITHUB_STEP_SUMMARY). */
import type { Comparison, ComparisonRow } from "./compare.ts"
import type { BenchResult } from "./types.ts"

export const fmt = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return "–"
  const abs = Math.abs(value)
  if (abs === 0) return "0"
  if (abs >= 1000) return value.toFixed(0)
  if (abs >= 100) return value.toFixed(1)
  if (abs >= 1) return value.toFixed(2)
  return value.toFixed(3)
}

const pct = (change: number | null) =>
  change === null ? "" : `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`

const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)))
  const line = (cells: ReadonlyArray<string>) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ")
  return [line(header), widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(line)].join("\n")
}

export const environmentLine = (result: BenchResult) => {
  const e = result.env
  return `${e.machine} · ${e.cpu} · ${e.cores} cores · ${e.memoryGiB} GiB · ${e.os} · bun ${e.bun} · ${e.daemon} Daemon · ${e.transport} · ${e.gitSha}${e.gitDirty ? "-dirty" : ""} · ${result.options.quick ? "quick" : "full"} × ${result.options.runs} run(s)`
}

export const renderResult = (result: BenchResult): string => {
  const out: Array<string> = [environmentLine(result), ""]
  for (const [name, scenario] of Object.entries(result.scenarios)) {
    out.push(`▸ ${name}  (${(scenario.durationMs / 1000).toFixed(1)} s)`)
    if (scenario.error) out.push(`  FAILED: ${scenario.error}`)
    const rows = Object.entries(scenario.metrics).map(([metric, m]) => [
      metric,
      fmt(m.value),
      m.unit,
      m.runs.length > 1 ? `${fmt(m.min)}–${fmt(m.max)}` : "",
    ])
    if (rows.length > 0) {
      out.push(
        table(["metric", "median", "unit", "range"], rows)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      )
    }
    for (const note of scenario.notes) out.push(`  note: ${note}`)
    out.push("")
  }
  return out.join("\n")
}

const mark = (row: ComparisonRow) =>
  row.status === "regressed"
    ? row.gating
      ? "REGRESSED"
      : "worse (not gating)"
    : row.status === "improved"
      ? "improved"
      : row.status

export const renderComparison = (comparison: Comparison, onlyChanges = false): string => {
  const rows = comparison.rows
    .filter((r) => !onlyChanges || r.status !== "ok")
    .map((r) => [
      `${r.scenario} ${r.metric}`,
      fmt(r.baseline),
      fmt(r.current),
      r.unit,
      pct(r.change),
      mark(r),
    ])
  const out = comparison.warnings.map((w) => `warning: ${w}`)
  out.push(table(["metric", "baseline", "current", "unit", "worse by", "status"], rows))
  out.push(
    comparison.regressions.length === 0
      ? "no regressions beyond tolerance"
      : `${comparison.regressions.length} regression(s) beyond tolerance`,
  )
  return out.join("\n")
}

export const renderMarkdown = (result: BenchResult, comparison: Comparison | null): string => {
  const out: Array<string> = ["## Daemon benchmarks", "", `_${environmentLine(result)}_`, ""]
  if (comparison) {
    for (const w of comparison.warnings) out.push(`> ⚠️ ${w}`)
    out.push(
      comparison.regressions.length === 0
        ? "**No gating regressions.**"
        : `**${comparison.regressions.length} gating regression(s).**`,
      "",
    )
  }
  const byKey = new Map(comparison?.rows.map((r) => [`${r.scenario}\u0000${r.metric}`, r]) ?? [])
  for (const [name, scenario] of Object.entries(result.scenarios)) {
    out.push(`### ${name}`, "")
    if (scenario.error) out.push(`**Failed:** \`${scenario.error}\``, "")
    out.push(
      comparison
        ? "| metric | value | unit | baseline | change | status |\n|---|---:|---|---:|---:|---|"
        : "| metric | value | unit |\n|---|---:|---|",
    )
    for (const [metric, m] of Object.entries(scenario.metrics)) {
      const row = byKey.get(`${name}\u0000${metric}`)
      out.push(
        comparison
          ? `| ${metric} | ${fmt(m.value)} | ${m.unit} | ${fmt(row?.baseline ?? null)} | ${pct(row?.change ?? null)} | ${row ? mark(row) : ""} |`
          : `| ${metric} | ${fmt(m.value)} | ${m.unit} |`,
      )
    }
    for (const note of scenario.notes) out.push("", `- ${note}`)
    out.push("")
  }
  return out.join("\n")
}
