import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import { ConstellationHarness } from "./attachments.ts";

test("empty startup and read-only opens do not load MCP; first interactive opens share the cached loader", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* ConstellationHarness;
      let loads = 0;

      const load = yield* Effect.cached(
        Effect.gen(function* () {
          loads++;
          yield* harness.activate({
            install: () => Effect.void,
            open: (id) => Effect.succeed({ constellations: [], environment: { session: id } }),
          });
        })
      );

      yield* harness.defer(load);
      expect(loads).toBe(0);
      expect(yield* harness.open(SessionId.make("reviewer"), true)).toEqual({
        constellations: [],
        environment: {},
      });
      expect(loads).toBe(0);

      const opened = yield* Effect.all(
        [harness.open(SessionId.make("one")), harness.open(SessionId.make("two"))],
        { concurrency: "unbounded" }
      );

      expect(loads).toBe(1);
      expect(opened.map((o) => o.environment.session)).toEqual(["one", "two"]);
    }).pipe(Effect.provide(ConstellationHarness.layer))
  );
});
