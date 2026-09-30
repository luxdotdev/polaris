/**
 * The Harnesses the scripted bench Harness replaces under `POLARIS_BENCH_HARNESS=1`:
 * the ones benchmarks and the dev Desktop App drive. Every other catalogue Harness
 * stays real in bench mode, with its real driver and probed availability.
 */
import type { HarnessKind } from "@polaris/protocol";

export const BENCH_KINDS = ["claude", "codex"] as const;

export const isBenchKind = (kind: HarnessKind): boolean =>
  BENCH_KINDS.some((bench) => bench === kind);
