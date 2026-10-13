import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { Context, Effect, Layer } from "effect";
import {
  LanguageRequestFence,
  LanguageTrustScope,
  PredictionContextRequest,
} from "@polaris/protocol";
import { fixture, hostId, run } from "../languages/composition/core.testing.ts";
import { LanguageTrustGrantAuthority } from "../languages/composition/ports.ts";
import { LanguageBroker } from "../languages/runtime/service.ts";
import { PredictionContextCore } from "./context.ts";

interface RequestHooks {
  duringRequest?: () => void;
}

// The real authority/Trust graph surrounds a fake Ready broker; no language process executes.
test("LSP context remains Trust-gated for an already-running server and same ClientId replacement", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      const acquired = yield* f.run(f.core.acquire(f.input));

      const scope = LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      let requests = 0;
      const hooks: RequestHooks = {};

      const broker = LanguageBroker.of({
        ...f.broker,
        predictionDocument: () =>
          Effect.succeed({
            fence: LanguageRequestFence.make({
              context: acquired.context,
              requiredSequence: 1,
              documents: [{ uri: pathToFileURL(f.input.path).href, version: 1 }],
            }),
            methods: ["textDocument/hover"],
            diagnostics: [],
          }),
        requestRaw: () =>
          Effect.sync(() => {
            requests++;
            hooks.duringRequest?.();

            return { contents: { value: "function saved(): string" } };
          }),
      });

      const services = Context.add(f.servicesContext, LanguageBroker, broker);

      const core = Context.get(
        yield* Layer.build(PredictionContextCore.layer(hostId)).pipe(Effect.provide(services)),
        PredictionContextCore
      );

      const input = PredictionContextRequest.make({
        workspaceId: f.checkout.workspaceId,
        path: f.input.path,
        buffer: "saved",
        cursor: 5,
        recentEdits: [],
        budgetTokens: 2048,
      });

      expect(yield* f.run(core.context(input))).toEqual([]);
      expect(requests).toBe(0);
      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );
      expect((yield* f.run(core.context(input)))[0]?.kind).toBe("definition");
      expect(requests).toBeGreaterThan(0);
      const before = requests;
      yield* f.run(
        f.core
          .trustSet(scope, false, 1)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );
      expect(yield* f.run(core.context(input))).toEqual([]);
      expect(requests).toBe(before);
      yield* f.run(
        f.core
          .trustSet(scope, true, 2)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );
      hooks.duringRequest = f.replace;
      expect(yield* Effect.flip(f.run(core.context(input)))).toHaveProperty(
        "reason",
        "unavailable"
      );
    })
  );
});
