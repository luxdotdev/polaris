import { expect, test } from "bun:test";
import { join } from "node:path";
import { Command, type HarnessKind, SessionId, SessionPlacement } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { ConstellationHarness } from "../constellation/composition/attachments.ts";
import type { ConstellationAttachment } from "../harness/constellation/attachment.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts";

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

test("a Harness whose driver declares Constellations gets the attachment; one that doesn't gets none", async () => {
  const copilot = makeFakeDriver("copilot", { constellations: true });
  const opencode = makeFakeDriver("opencode");

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [copilot, opencode],
  }).pipe(Layer.provideMerge(ConstellationHarness.layer));

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* ConstellationHarness).activate({
        install: () => Effect.void,
        open: (sessionId) =>
          Effect.succeed({
            // SAFETY: the supervisor only forwards the attachment; the driver never calls it here.
            constellations: [{ sessionId } as ConstellationAttachment],
            environment: { POLARIS_SESSION_ID: sessionId },
          }),
      });

      const repo = fakeRepo();
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
      const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
      const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;

      const start = (harness: HarnessKind, id: string) =>
        dispatch(
          Command.cases.StartSession.make({
            sessionId: SessionId.make(id),
            workspaceId: workspace.id,
            harness,
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Hi",
            attachments: [],
          })
        );

      yield* start("copilot", "s-copilot");
      yield* start("opencode", "s-opencode");
      yield* waitUntil(() => copilot.sessions.length === 1 && opencode.sessions.length === 1);

      expect(copilot.sessions[0]!.options.constellations?.map((a) => a.sessionId)).toEqual([
        SessionId.make("s-copilot"),
      ]);
      expect(opencode.sessions[0]!.options.constellations).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
});
