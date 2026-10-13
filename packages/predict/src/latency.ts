import type { PredictionEndpoint } from "@polaris/protocol";

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
    const values = this.samples
      .get(`${endpoint.kind}:${endpoint.url.replace(/\/$/, "")}`)
      ?.toSorted((a, b) => a - b);

    return values?.[Math.floor(values.length / 2)] ?? null;
  }
}
