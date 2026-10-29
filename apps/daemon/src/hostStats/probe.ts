/**
 * Reads the Host's CPU times, load, memory and disk once. Each read is a few
 * syscalls or small procfs reads, cheap enough every two seconds on a Raspberry Pi.
 */
import { readFileSync, statfsSync } from "node:fs";
import { availableParallelism, cpus, freemem, loadavg, totalmem } from "node:os";
import type { HostDiskUsage } from "@polaris/protocol";
import { darwinMemoryUsed } from "./darwinMemory.ts";

/** Cumulative CPU time across all cores, in any one unit. */
export interface CpuTimes {
  readonly busy: number;
  readonly total: number;
}

export interface HostReading {
  readonly cpu: CpuTimes;
  readonly loadAverage: readonly [number, number, number] | null;
  readonly memory: { readonly usedBytes: number; readonly totalBytes: number };
  readonly disk: typeof HostDiskUsage.Encoded | null;
}

/** The boundary `HostStats` samples through; tests pass a fake. */
export interface HostProbe {
  readonly cores: () => number;
  readonly read: () => HostReading;
}

/** `/proc/stat`'s aggregate `cpu` line: idle and iowait are idle; guest time is already in user. */
export const parseProcStat = (text: string): CpuTimes | null => {
  const line = text.slice(0, text.indexOf("\n"));

  if (!line.startsWith("cpu ")) return null;
  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);

  if (fields.length < 5 || fields.some(Number.isNaN)) return null;
  const total = fields.reduce((sum, value) => sum + value, 0);

  return { busy: total - (fields[3] ?? 0) - (fields[4] ?? 0), total };
};

/** Total minus MemAvailable (the kernel's estimate of what can be had without swapping), in bytes. */
export const parseMeminfo = (text: string): HostReading["memory"] | null => {
  const kib = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(text);

    return match?.[1] === undefined ? null : Number(match[1]) * 1024;
  };

  const total = kib("MemTotal");
  const available = kib("MemAvailable");

  if (total === null || available === null) return null;

  return { usedBytes: Math.max(0, total - available), totalBytes: total };
};

const osCpuTimes = (): CpuTimes => {
  let busy = 0;
  let total = 0;

  for (const { times } of cpus()) {
    const all = times.user + times.nice + times.sys + times.irq + times.idle;
    busy += all - times.idle;
    total += all;
  }

  return { busy, total };
};

const readOr = <A>(read: () => A | null, fallback: () => A): A => {
  try {
    return read() ?? fallback();
  } catch {
    return fallback();
  }
};

const freeMemory = () => ({
  usedBytes: Math.max(0, totalmem() - freemem()),
  totalBytes: totalmem(),
});

const memory = (platform: NodeJS.Platform): HostReading["memory"] => {
  if (platform === "linux")
    return readOr(() => parseMeminfo(readFileSync("/proc/meminfo", "utf8")), freeMemory);

  if (platform === "darwin")
    return readOr(() => {
      const used = darwinMemoryUsed();

      return used === null ? null : { usedBytes: used, totalBytes: totalmem() };
    }, freeMemory);

  return freeMemory();
};

/** Used is total less what an unprivileged user can still write, so a full disk reads 100%. */
const disk = (path: string): HostReading["disk"] => {
  try {
    const { blocks, bavail, bsize } = statfsSync(path);

    return { path, usedBytes: (blocks - bavail) * bsize, totalBytes: blocks * bsize };
  } catch {
    return null;
  }
};

/** The real Host, its disk read at `diskPath` (the Daemon home). */
export const systemProbe = (diskPath: string, platform = process.platform): HostProbe => ({
  cores: () => cpus().length || availableParallelism(),
  read: () => ({
    cpu:
      platform === "linux"
        ? readOr(() => parseProcStat(readFileSync("/proc/stat", "utf8")), osCpuTimes)
        : osCpuTimes(),
    // SAFETY: os.loadavg() always answers three numbers; Windows has none and answers zeros.
    loadAverage: platform === "win32" ? null : (loadavg() as [number, number, number]),
    memory: memory(platform),
    disk: disk(diskPath),
  }),
});
