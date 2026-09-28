import { describe, expect, test } from "bun:test"
import { processTree, procReader } from "./proc.ts"

describe("procReader", () => {
  test("reads this process: RSS and CPU time in the right units", () => {
    const reader = procReader()
    const start = process.cpuUsage()
    const before = reader.read(process.pid)
    // Burn ~150 ms of CPU.
    const until = performance.now() + 150
    let x = 0
    while (performance.now() < until) x += Math.sqrt(x + 1)
    const after = reader.read(process.pid)
    const used = process.cpuUsage(start)
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    const selfNs = (used.user + used.system) * 1000
    const measuredNs = after!.cpuNs - before!.cpuNs
    // Within 50 ms of what the process itself reports. The ps fallback has 10 ms
    // resolution on macOS but whole seconds on Linux (where procfs is always used).
    if (reader.backend !== "ps" || process.platform === "darwin") {
      expect(Math.abs(measuredNs - selfNs)).toBeLessThan(50e6)
    }
    const rss = process.memoryUsage().rss
    expect(after!.rssBytes).toBeGreaterThan(rss * 0.5)
    expect(after!.rssBytes).toBeLessThan(rss * 2)
    expect(x).toBeGreaterThan(0)
  })

  test("walks children", async () => {
    const child = Bun.spawn(["sleep", "5"])
    try {
      await Bun.sleep(200)
      expect(processTree(process.pid)).toContain(child.pid)
      expect(procReader().read(child.pid)?.name).toContain("sleep")
    } finally {
      child.kill()
    }
  })
})
