/**
 * Model-based test of Attempt leases (ENG-1015) against `leaseExpire` and `leaseSettlesOnlySilent`
 * in `packages/spec/constellations.qnt`: random time, activity and Offline Host steps after a
 * Stopped notice, checked against the real delivery runner on the test clock.
 */
import { expect, test } from "bun:test";
import { AttemptId, CommandId } from "@polaris/protocol";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { C, CID, HOST } from "../engine/constellation.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { ConstellationDelivery } from "../constellation/delivery/index.ts";
import { LEASE_MS } from "../constellation/delivery/lease.ts";
import { WORKER, send, setup, silentTwice, world } from "../constellation/delivery/testing.ts";
import { observeWorkerHost } from "../constellation/recovery.ts";
import { ConstellationOwner } from "../constellation/runtime.ts";
import { Constellations } from "../constellation/service.ts";
import { pbtRuns, pbtSeed, pbtTimeout } from "./pbt.ts";

const ATTEMPT = AttemptId.make("a1");

type Op =
  | { readonly kind: "advance"; readonly ms: number }
  | { readonly kind: "progress" }
  | { readonly kind: "turn" }
  | { readonly kind: "offline" }
  | { readonly kind: "online" };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .integer({ min: 0, max: 6 * 60_000 })
      .map((ms) => ({ kind: "advance" as const, ms })),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "progress" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "turn" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "offline" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "online" as const }) }
);

/** The spec's view: the lease runs from the Stopped notice until activity; Offline holds it. */
interface Model {
  now: number;
  readonly until: number;
  active: boolean;
  offline: boolean;
  lost: boolean;
}

const expire = (m: Model) => {
  if (m.active && !m.offline && !m.lost && m.now >= m.until) m.lost = true;
};

const stepModel = (m: Model, o: Op) => {
  if (m.lost) return;

  if (o.kind === "advance") m.now += o.ms;
  else if (o.kind === "progress" || o.kind === "turn") m.active = false;
  else m.offline = o.kind === "offline";
  expire(m);
};

const stepReal = Effect.fnUntraced(function* (o: Op) {
  const host = (offline: boolean) =>
    observeWorkerHost(HOST, offline).pipe(Effect.provideService(ConstellationOwner, HOST));

  if (o.kind === "advance") yield* TestClock.adjust(o.ms);
  else if (o.kind === "turn") {
    const turns = (yield* (yield* EventStore).model).sessions.get(WORKER)!.turns;

    if (turns.at(-1)?.status !== "working") yield* send(WORKER, "Keep going");
  } else if (o.kind === "offline" || o.kind === "online") yield* host(o.kind === "offline");
  else
    yield* (yield* Constellations).command(
      { kind: "session", sessionId: WORKER },
      CommandId.make(crypto.randomUUID()),
      C.WorkerProgress.make({
        constellationId: CID,
        attemptId: ATTEMPT,
        note: "Still here",
        completed: null,
        total: null,
      })
    );
  yield* (yield* ConstellationDelivery).flush();
});

const state = Effect.gen(function* () {
  const record = (yield* (yield* EventStore).model).constellations.get(CID)!;

  return record.graph.attempts.find((a) => a.id === ATTEMPT)!.state;
});

const runs = pbtRuns(25);

test(
  "a lease settles lost exactly when the spec's leaseExpire is enabled",
  async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 8 }), async (ops) => {
        const w = world();
        await w.run(
          Effect.gen(function* () {
            yield* setup();
            const since = yield* silentTwice(w, ATTEMPT);
            yield* TestClock.setTime(since);

            const model: Model = {
              now: since,
              until: since + LEASE_MS,
              active: true,
              offline: false,
              lost: false,
            };

            for (const o of ops) {
              // A settled Attempt refuses worker commands; the property ends at the settle.
              if (model.lost) break;
              stepModel(model, o);
              yield* stepReal(o);
              expect({ op: o.kind, state: yield* state }).toEqual({
                op: o.kind,
                state: model.lost ? "lost" : "working",
              });
            }
          })
        );
      }),
      { numRuns: runs, ...pbtSeed() }
    );
  },
  pbtTimeout(runs, 1000)
);
