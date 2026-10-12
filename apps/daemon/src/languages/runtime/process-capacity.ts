import { availableParallelism, freemem, totalmem } from "node:os";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const SERVER_ALLOWANCE_BYTES = 832 * 1024 * 1024;

export const MAX_LANGUAGE_PROCESSES = 32;

export interface HostProcessResources {
  cpuCount: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
}

/** Measured startup RSS plus headroom; policy and evidence are in ADR 0033. */
export function deriveProcessLimit(resources: HostProcessResources) {
  const total = Math.max(0, resources.totalMemoryBytes);
  const available = Math.min(total, Math.max(0, resources.availableMemoryBytes));
  const memoryPool = Math.min(total / 2, total / 4 + available);
  const cores = Math.max(1, Math.floor(resources.cpuCount));
  const floor = Math.min(4, cores, Math.max(1, Math.floor(total / SERVER_ALLOWANCE_BYTES)));

  return Math.min(
    MAX_LANGUAGE_PROCESSES,
    Math.max(floor, Math.min(cores * 2, Math.floor(memoryPool / SERVER_ALLOWANCE_BYTES)))
  );
}

export function reclaimableDarwinMemory(text: string) {
  const pageSize = /page size of (\d+) bytes/.exec(text)?.[1];

  const counts = ["free", "inactive", "speculative"].map(
    (name) => new RegExp(`Pages ${name}:\\s+(\\d+)\\.`).exec(text)?.[1]
  );

  if (pageSize === undefined || counts.some((count) => count === undefined)) return null;

  return Number(pageSize) * counts.reduce((sum, count) => sum + Number(count), 0);
}

/** Observe once when language services load; no idle polling or process monitor. */
export function hostProcessResources(): HostProcessResources {
  const constrained = process.constrainedMemory();
  const totalMemoryBytes = constrained > 0 ? Math.min(totalmem(), constrained) : totalmem();
  let availableMemoryBytes = freemem();

  try {
    if (process.platform === "linux") {
      const available = /^MemAvailable:\s+(\d+) kB$/m.exec(
        readFileSync("/proc/meminfo", "utf8")
      )?.[1];

      if (available !== undefined) availableMemoryBytes = Number(available) * 1024;
    } else if (process.platform === "darwin") {
      availableMemoryBytes =
        reclaimableDarwinMemory(
          execFileSync("/usr/bin/vm_stat", {
            encoding: "utf8",
            timeout: 500,
            maxBuffer: 16384,
          })
        ) ?? availableMemoryBytes;
    }
  } catch {
    // Free memory remains the fallback when platform observations are unavailable.
  }

  return {
    cpuCount: availableParallelism(),
    totalMemoryBytes,
    availableMemoryBytes: Math.min(totalMemoryBytes, availableMemoryBytes),
  };
}
