import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { fixture } from "./fixture.ts";
import { ProjectDiscovery } from "./index.ts";
import { ExecutionTrustService, createFileTrustRepository } from "../trust/index.ts";

test("Effect Layers are inert until demand and preserve canonical checkout/trust behavior", async () => {
  const f = await fixture();

  try {
    const path = await f.put("file.ts");
    let lookups = 0;

    const registry: typeof f.registry = async (checkout) => {
      lookups++;

      return f.registry(checkout);
    };

    const layer = Layer.merge(
      ProjectDiscovery.layer({ registry }),
      ExecutionTrustService.layer({
        hostId: f.hostId,
        registry,
        repository: createFileTrustRepository(join(f.temporary, "state")),
        authorizeGrant: async () => {},
      })
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const discovery = yield* ProjectDiscovery;
        const trust = yield* ExecutionTrustService;
        expect(lookups).toBe(0);
        expect((yield* trust.inspect(f.checkout)).trust.trusted).toBe(false);
        yield* trust.set(f.checkout, true, 0);
        expect((yield* trust.require(f.treeCheckout)).root).toBe(f.worktree);

        const result = yield* discovery.discover({
          checkout: f.checkout,
          path,
          providerId: "typescript",
          settings: f.settings,
        });

        expect(result.projectRoot).toBe(f.root);
        yield* discovery.invalidate;
      }).pipe(Effect.provide(layer))
    );
  } finally {
    await f.cleanup();
  }
});
