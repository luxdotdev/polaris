/** Small statistics helpers shared by the sampler, scenarios and reports. */

export interface Summary {
  readonly n: number
  readonly min: number
  readonly median: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly mean: number
}

/** Nearest-rank percentile of a sorted array; `q` in [0, 1]. */
export const quantile = (sorted: ReadonlyArray<number>, q: number): number => {
  if (sorted.length === 0) return Number.NaN
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[rank]!
}

export const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return Number.NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export const summarize = (values: ReadonlyArray<number>): Summary => {
  const s = [...values].sort((a, b) => a - b)
  return {
    n: s.length,
    min: s[0] ?? Number.NaN,
    median: median(s),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    max: s.at(-1) ?? Number.NaN,
    mean: s.length === 0 ? Number.NaN : s.reduce((a, b) => a + b, 0) / s.length,
  }
}

export const MiB = 1024 * 1024
export const toMiB = (bytes: number) => bytes / MiB
