/**
 * Process-tree sampler: memory and CPU of a root process and all its
 * descendants (for the Daemon: Harness children, git, terminals), read at a
 * fixed interval with `proc.ts`. Built to be reused for the Desktop App, whose
 * Electron main process is the root of its renderer and helper processes.
 *
 *   const sampler = startSampler({ roots: () => [daemon.pid], intervalMs: 250 })
 *   ...load...
 *   const report = sampler.report()          // whole run, or report(from, to) for a window
 *   sampler.stop()
 *
 * CPU is the change in user + system time of every process in the tree between
 * samples, including children that exited and were reaped in between (their time
 * lands in the parent's child counters), divided by wall time: 100% = one core.
 * Memory is summed over the tree at each sample.
 */
import { type ProcCounters, processTree, procReader } from "./proc.ts"
import { type Summary, summarize } from "./stats.ts"

export interface TreeSample {
  /** ms since the sampler started. */
  readonly t: number
  readonly rssBytes: number
  readonly footprintBytes: number | null
  /** CPU used by the tree since the previous sample, as % of one core. */
  readonly cpuPct: number
  /** CPU ns used by the tree since the previous sample. */
  readonly cpuNs: number
  /** Wakeups (macOS) or context switches (Linux) since the previous sample. */
  readonly wakeups: number | null
  readonly processes: number
}

export interface ProcessPeak {
  readonly pid: number
  readonly name: string
  readonly maxRssBytes: number
  readonly cpuSeconds: number
}

export interface TreeReport {
  readonly backend: string
  readonly durationMs: number
  readonly samples: number
  readonly rssBytes: Summary
  readonly footprintBytes: Summary | null
  /** Per-interval CPU %, 100 = one core. */
  readonly cpuPct: Summary
  /** Total CPU over the window divided by its length, % of one core. */
  readonly cpuAvgPct: number
  readonly cpuSeconds: number
  readonly wakeupsPerSec: number | null
  readonly maxProcesses: number
  readonly processes: ReadonlyArray<ProcessPeak>
}

export interface SamplerOptions {
  /** Root pids to follow; called at every sample so a restarted process is picked up. */
  readonly roots: () => ReadonlyArray<number>
  readonly intervalMs?: number
}

export interface Sampler {
  /** ms since start. */
  readonly now: () => number
  /** Take a sample right away (also done on every tick). */
  readonly sample: () => TreeSample
  readonly samples: () => ReadonlyArray<TreeSample>
  /** Statistics over samples with `from < t <= to` (default: all). */
  readonly report: (from?: number, to?: number) => TreeReport
  readonly stop: () => void
}

export const startSampler = (options: SamplerOptions): Sampler => {
  const reader = procReader()
  const started = performance.now()
  const now = () => performance.now() - started
  const samples: Array<TreeSample> = []
  let previous = new Map<number, ProcCounters>()
  let previousT = 0
  const peaks = new Map<number, { name: string; maxRssBytes: number; cpuNs: number }>()

  const sample = (): TreeSample => {
    const t = now()
    const pids = new Set<number>()
    for (const root of options.roots()) for (const pid of processTree(root, reader)) pids.add(pid)
    const current = new Map<number, ProcCounters>()
    let rssBytes = 0
    let footprint: number | null = 0
    let cpuNs = 0
    let wakeups: number | null = 0
    for (const pid of pids) {
      const counters = reader.read(pid)
      if (counters === null) continue
      current.set(pid, counters)
      rssBytes += counters.rssBytes
      footprint =
        footprint === null || counters.footprintBytes === null
          ? null
          : footprint + counters.footprintBytes
      const before = previous.get(pid)
      const total = counters.cpuNs + counters.childCpuNs
      const delta = before === undefined ? total : total - before.cpuNs - before.childCpuNs
      cpuNs += Math.max(0, delta)
      if (wakeups !== null && counters.wakeups !== null) {
        wakeups += Math.max(0, counters.wakeups - (before?.wakeups ?? counters.wakeups))
      } else wakeups = null
      const peak = peaks.get(pid) ?? { name: counters.name, maxRssBytes: 0, cpuNs: 0 }
      peak.maxRssBytes = Math.max(peak.maxRssBytes, counters.rssBytes)
      peak.cpuNs = counters.cpuNs
      peak.name = counters.name || peak.name
      peaks.set(pid, peak)
    }
    const dt = Math.max(1e-6, t - previousT)
    // The first sample only sets the baseline for deltas.
    const first = samples.length === 0 && previous.size === 0
    const s: TreeSample = {
      t,
      rssBytes,
      footprintBytes: footprint,
      cpuNs: first ? 0 : cpuNs,
      cpuPct: first ? 0 : (cpuNs / 1e6 / dt) * 100,
      wakeups: first ? 0 : wakeups,
      processes: current.size,
    }
    previous = current
    previousT = t
    samples.push(s)
    return s
  }

  sample()
  const timer = setInterval(sample, options.intervalMs ?? 250)

  const report = (from = Number.NEGATIVE_INFINITY, to = Number.POSITIVE_INFINITY): TreeReport => {
    const window = samples.filter((s) => s.t > from && s.t <= to)
    const startT = Math.max(samples.find((s) => s.t > from)?.t ?? 0, from)
    const endT = window.at(-1)?.t ?? startT
    // The first sample in the window covers the interval before it; exclude it from rates.
    const rated = window.slice(1)
    const durationMs = rated.length > 0 ? endT - window[0]!.t : 0
    const cpuNs = rated.reduce((a, s) => a + s.cpuNs, 0)
    const wakeups = rated.every((s) => s.wakeups !== null)
      ? rated.reduce((a, s) => a + (s.wakeups ?? 0), 0)
      : null
    const footprints = window.map((s) => s.footprintBytes)
    return {
      backend: reader.backend,
      durationMs,
      samples: window.length,
      rssBytes: summarize(window.map((s) => s.rssBytes)),
      footprintBytes: footprints.every((f) => f !== null)
        ? summarize(footprints as Array<number>)
        : null,
      cpuPct: summarize(rated.map((s) => s.cpuPct)),
      cpuAvgPct: durationMs > 0 ? (cpuNs / 1e6 / durationMs) * 100 : 0,
      cpuSeconds: cpuNs / 1e9,
      wakeupsPerSec: wakeups === null || durationMs <= 0 ? null : wakeups / (durationMs / 1000),
      maxProcesses: Math.max(0, ...window.map((s) => s.processes)),
      processes: [...peaks.entries()]
        .map(([pid, p]) => ({
          pid,
          name: p.name,
          maxRssBytes: p.maxRssBytes,
          cpuSeconds: p.cpuNs / 1e9,
        }))
        .sort((a, b) => b.maxRssBytes - a.maxRssBytes),
    }
  }

  return {
    now,
    sample,
    samples: () => samples,
    report,
    stop: () => clearInterval(timer),
  }
}
