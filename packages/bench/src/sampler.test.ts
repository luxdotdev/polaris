import { expect, test } from "bun:test"
import { startSampler } from "./sampler.ts"

test("samples a busy child's CPU and memory, and an idle one's near zero", async () => {
  const busy = Bun.spawn([
    "bun",
    "-e",
    "const end = Date.now() + 3000; while (Date.now() < end) {}",
  ])
  const idle = Bun.spawn(["bun", "-e", "setTimeout(() => {}, 3000)"])
  const busySampler = startSampler({ roots: () => [busy.pid], intervalMs: 100 })
  const idleSampler = startSampler({ roots: () => [idle.pid], intervalMs: 100 })
  try {
    await Bun.sleep(300)
    const from = busySampler.now()
    const idleFrom = idleSampler.now()
    await Bun.sleep(1000)
    const b = busySampler.report(from)
    const i = idleSampler.report(idleFrom)
    expect(b.samples).toBeGreaterThanOrEqual(5)
    expect(b.cpuAvgPct).toBeGreaterThan(30)
    expect(b.cpuAvgPct).toBeLessThan(160)
    expect(b.rssBytes.median).toBeGreaterThan(5 * 1024 * 1024)
    expect(i.cpuAvgPct).toBeLessThan(10)
    expect(b.processes.some((p) => p.pid === busy.pid)).toBe(true)
  } finally {
    busySampler.stop()
    idleSampler.stop()
    busy.kill()
    idle.kill()
  }
})
