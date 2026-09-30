import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command, DomainEvent, SessionId, SessionPlacement } from "@polaris/protocol";
import { Effect, type Layer } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
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

describe("context usage", () => {
  test("Harness reports become session state, only when the header would change", async () => {
    const claude = makeFakeDriver("claude");
    const filename = join(tempDir(), "state.sqlite");
    const layer = engineLayer({ filename, fakes: makeFakes(), drivers: [claude] });

    await run(
      layer,
      Effect.gen(function* () {
        const repo = fakeRepo();
        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        const workspace = [...model.workspaces.values()][0]!;
        const s = SessionId.make("s-context");
        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: s,
            workspaceId: workspace.id,
            harness: "claude",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Fix the flaky test",
            attachments: [],
          })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const harness = claude.latest(s)!;

        harness.emit(HarnessEvent.ContextUsed({ usedTokens: 40_000, windowTokens: 200_000 }));
        // Under a percent of the window: not worth an event.
        harness.emit(HarnessEvent.ContextUsed({ usedTokens: 41_000, windowTokens: 200_000 }));
        harness.emit(HarnessEvent.ContextUsed({ usedTokens: 90_000, windowTokens: 200_000 }));

        const after = yield* waitFor(
          (m) => m.sessions.get(s)?.session.contextUsage?.usedTokens === 90_000
        );

        expect(after.sessions.get(s)!.session.contextUsage).toMatchObject({
          usedTokens: 90_000,
          windowTokens: 200_000,
        });

        const store = yield* EventStore;
        const upTo = (yield* store.model).sequence;

        const read = (sessionId: SessionId | null) =>
          store
            .readEvents({ after: 0, upTo, sessionId })
            .pipe(
              Effect.map((all) =>
                all.map((e) => e.event).filter(DomainEvent.guards.SessionContextUsed)
              )
            );

        expect((yield* read(s)).length).toBe(2);
        // The Host stream leaves it out: only an open session shows it.
        expect(yield* read(null)).toEqual([]);
      })
    );
  });
});
