import { PredictionError } from "@polaris/protocol";
import { placementMachine, type PlacementSnapshot } from "./machine.ts";
import { scorePlacement } from "./score.ts";
import type { PlacementInput, PredictionTarget } from "./types.ts";

/** One controller per Workspace's Host. Cancellation and newer probes invalidate old outcomes. */
export class PlacementController {
  private snapshot: PlacementSnapshot = placementMachine.initialState;
  private generation = 0;

  get state() {
    return this.snapshot;
  }

  off() {
    this.generation++;
    this.snapshot = placementMachine.transition(this.snapshot, { type: "off" })[0];
  }

  async probe(read: () => Promise<PlacementInput>): Promise<PlacementSnapshot> {
    const generation = ++this.generation;
    this.snapshot = placementMachine.transition(this.snapshot, { type: "probe" })[0];
    const input = await read();

    if (generation !== this.generation) return this.snapshot;
    this.snapshot = placementMachine.transition(this.snapshot, {
      type: "probed",
      candidates: scorePlacement(input),
    })[0];

    return this.snapshot;
  }

  /** A failed request moves to the other side once; an explicit override stays on its side. */
  async run<A>(serve: (target: PredictionTarget) => Promise<A>, signal: AbortSignal): Promise<A> {
    const generation = this.generation;

    for (;;) {
      signal.throwIfAborted();

      if (generation !== this.generation)
        throw new PredictionError({
          reason: "unavailable",
          message: "Prediction placement changed",
        });
      const target = this.snapshot.context.serving;

      if (target === null)
        throw new PredictionError({
          reason: "unavailable",
          message: "No prediction endpoint available",
        });

      try {
        const result = await serve(target);
        signal.throwIfAborted();

        if (generation !== this.generation)
          throw new PredictionError({
            reason: "unavailable",
            message: "Prediction placement changed",
          });

        return result;
      } catch (error) {
        signal.throwIfAborted();

        if (generation !== this.generation) throw error;
        this.snapshot = placementMachine.transition(this.snapshot, { type: "failed" })[0];
        this.snapshot = placementMachine.transition(this.snapshot, { type: "fallback" })[0];

        if (this.snapshot.context.serving === null) throw error;
      }
    }
  }
}
