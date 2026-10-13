import type { PredictionEndpoint } from "@polaris/protocol";

export interface LatencyStats {
  readonly p50: number;
  readonly last: number;
  readonly count: number;
}

/** Bounded request-driven recorder; no timers or idle work. Only successful requests count. */
export class LatencyRecorder {
  private readonly samples = new Map<string, number[]>();

  record(endpoint: PredictionEndpoint, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const key = `${endpoint.kind}:${endpoint.url.replace(/\/$/, "")}`;
    const values = this.samples.get(key) ?? [];
    values.push(elapsedMs);

    if (values.length > 31) values.shift();
    this.samples.delete(key);
    this.samples.set(key, values);

    if (this.samples.size > 32) {
      const first = this.samples.keys().next().value;

      if (first !== undefined) this.samples.delete(first);
    }
  }

  p50(endpoint: PredictionEndpoint): number | null {
    return this.stats(endpoint)?.p50 ?? null;
  }

  /** The median, the latest and how many recent successes they cover; null before the first. */
  stats(endpoint: PredictionEndpoint): LatencyStats | null {
    const values = this.samples.get(`${endpoint.kind}:${endpoint.url.replace(/\/$/, "")}`);
    const last = values?.at(-1);

    if (values === undefined || last === undefined) return null;
    const sorted = values.toSorted((a, b) => a - b);

    return { p50: sorted[Math.floor(sorted.length / 2)] ?? last, last, count: values.length };
  }
}
