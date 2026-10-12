import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement } from "@polaris/protocol";
import { Effect, type Layer } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const s = SessionId.make("s-pin");

const sequence = Effect.map(
  Effect.flatMap(EventStore, (store) => store.model),
  (m) => m.sequence
);

const pin = (pinned: boolean) => dispatch(Command.cases.PinSession.make({ sessionId: s, pinned }));

describe("pins and origin", () => {
  test("a pin is a Daemon event that survives a restart; asking twice commits once", async () => {
    const filename = join(tempDir(), "state.sqlite");

    const layer = () =>
      engineLayer({ filename, fakes: makeFakes(), drivers: [makeFakeDriver("claude")] });

    await run(
      layer(),
      Effect.gen(function* () {
        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        const workspace = [...model.workspaces.values()][0]!;

        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: s,
            workspaceId: workspace.id,
            harness: "claude",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Walk through the change",
            attachments: [],
            origin: "walkthrough",
          })
        );
        yield* waitFor((m) => m.sessions.has(s));

        yield* pin(true);
        const pinned = yield* waitFor((m) => m.sessions.get(s)?.session.pinnedAt != null);
        const at = pinned.sessions.get(s)!.session.pinnedAt;
        const before = yield* sequence;

        yield* pin(true);
        expect(yield* sequence).toBe(before);

        yield* pin(false);
        yield* waitFor((m) => m.sessions.get(s)?.session.pinnedAt === null);
        yield* pin(true);
        const again = yield* waitFor((m) => m.sessions.get(s)?.session.pinnedAt != null);
        expect(again.sessions.get(s)!.session.pinnedAt! >= at!).toBe(true);
      })
    );

    await run(
      layer(),
      Effect.gen(function* () {
        const model = yield* Effect.flatMap(EventStore, (store) => store.model);
        const session = model.sessions.get(s)!.session;

        expect(session.origin).toBe("walkthrough");
        expect(session.pinnedAt).not.toBeNull();
      })
    );
  });

  test("pinning an unknown session is refused", async () => {
    const layer = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [makeFakeDriver("claude")],
    });

    const outcome = await run(layer, Effect.result(pin(true)));

    expect(outcome._tag).toBe("Failure");
  });
});
