import { expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { RpcTest } from "effect/rpc";
import { SettingsRpcs } from "@polaris/protocol";
import { Engine } from "../engine/Engine.ts";
import { engineLayer, makeFakes, tempDir } from "../engine/testing.ts";
import { settingsRpcHandlersAt } from "./rpc.ts";

test("generic settings RPC changes reach the Engine's live preferences", async () => {
  const root = tempDir();

  const layer = engineLayer({
    filename: join(root, "state.sqlite"),
    fakes: makeFakes(),
    drivers: [],
  });

  const handlers = settingsRpcHandlersAt(() => join(root, "host-settings.json"));

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* Engine;
        const client = yield* RpcTest.makeClient(SettingsRpcs).pipe(Effect.provide(handlers));

        const budget = yield* Effect.result(
          client["settings.set"]({ key: "sessions.startLimit", value: 8 })
        );

        expect(budget).toHaveProperty("failure._tag", "SettingsError");
        expect(yield* engine.sessionStartLimit).toBe(5);
        yield* client["settings.set"]({ key: "sessions.autoArchive.afterDays", value: null });
        expect((yield* engine.autoArchiveSettings).afterDays).toBeNull();
        yield* client["settings.set"]({ key: "sessions.idleCompaction.minTokens", value: 50000 });
        expect((yield* engine.idleCompactionSettings).minTokens).toBe(50000);
        yield* client["settings.set"]({ key: "sessions.suggestedReplies.enabled", value: true });
        expect(engine.suggestedReplies.enabledNow()).toBe(true);
        expect((yield* engine.suggestedReplies.current).enabled).toBe(true);
      }).pipe(Effect.provide(layer))
    )
  );
});
