import { setup, types } from "xstate/fsm";
import type { PredictionSide, PredictionTarget } from "./types.ts";

interface PlacementContext {
  readonly candidates: ReadonlyArray<PredictionTarget>;
  readonly serving: PredictionTarget | null;
  readonly failedSides: ReadonlyArray<PredictionSide>;
}

type Probed = { readonly candidates: ReadonlyArray<PredictionTarget> };

const probe = {
  target: "probing" as const,
  context: { serving: null, candidates: [], failedSides: [] },
};

const off = { target: "off" as const, context: { serving: null, candidates: [], failedSides: [] } };

export const placementMachine = setup({
  schemas: {
    context: types<PlacementContext>(),
    events: {
      probe: types<Record<never, never>>(),
      probed: types<Probed>(),
      failed: types<Record<never, never>>(),
      fallback: types<Record<never, never>>(),
      off: types<Record<never, never>>(),
    },
  },
}).createFSM({
  id: "prediction-placement",
  initial: "probing",
  context: { candidates: [], serving: null, failedSides: [] },
  states: {
    probing: {
      on: {
        probe,
        off,
        probed: ({ event }) => ({
          target: event.candidates.length === 0 ? "off" : "serving",
          context: {
            candidates: event.candidates,
            serving: event.candidates[0] ?? null,
            failedSides: [],
          },
        }),
      },
    },
    serving: {
      on: {
        probe,
        off,
        failed: ({ context }) => ({
          target: "degraded",
          context: {
            serving: null,
            failedSides:
              context.serving === null
                ? context.failedSides
                : [...context.failedSides, context.serving.side],
          },
        }),
      },
    },
    degraded: {
      on: {
        probe,
        off,
        fallback: ({ context }) => {
          const serving =
            context.candidates.find((target) => !context.failedSides.includes(target.side)) ?? null;

          return { target: serving === null ? "off" : "serving", context: { serving } };
        },
      },
    },
    off: { on: { probe, off } },
  },
});

export type PlacementSnapshot = typeof placementMachine.initialState;
