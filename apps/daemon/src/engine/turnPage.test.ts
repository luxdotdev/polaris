/** `session.turns`: older Turns a page at a time, for a Client that opened on the latest few. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Command, NotFound, SessionId, SessionPlacement } from "@polaris/protocol";
import { Effect, Exit } from "effect";
import { makeRepo } from "../git/testing.ts";
import { Engine } from "./Engine.ts";
import { MAX_TURN_PAGE } from "./streams.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const sessionId = SessionId.make("s-paging");

const withTurns = (turns: number) =>
  Effect.gen(function* () {
    const repo = yield* Effect.promise(() => makeRepo());
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
    const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;

    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "turn 0",
        attachments: [],
      })
    );

    for (let i = 1; i < turns; i++) {
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
      yield* dispatch(
        Command.cases.SendTurn.make({ sessionId, prompt: `turn ${i}`, attachments: [] })
      );
    }

    yield* waitFor(
      (m) =>
        m.sessions.get(sessionId)?.session.turnCount === turns &&
        m.sessions.get(sessionId)?.session.state === "idle"
    );
  });

const layer = () =>
  engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [makeFakeDriver("claude", { onTurn: completesTurns() })],
  });

test("pages walk back from the oldest Turn the Client has to the first", async () => {
  const pages = await Effect.runPromise(
    Effect.gen(function* () {
      yield* withTurns(7);
      const engine = yield* Engine;
      const first = yield* engine.readTurnPage({ sessionId, beforeIndex: 4, limit: 3 });
      const last = yield* engine.readTurnPage({ sessionId, beforeIndex: 1, limit: 3 });

      return { first, last };
    }).pipe(Effect.provide(layer()))
  );

  expect(pages.first.turns.map((t) => t.turn.index)).toEqual([1, 2, 3]);
  expect(pages.first.turns.map((t) => t.turn.prompt)).toEqual(["turn 1", "turn 2", "turn 3"]);
  expect(pages.first.hasMore).toBe(true);
  expect(pages.last.turns.map((t) => t.turn.index)).toEqual([0]);
  expect(pages.last.hasMore).toBe(false);
}, 30_000);

test("a page is capped, and an unknown session is NotFound", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* withTurns(2);
      const engine = yield* Engine;
      const page = yield* engine.readTurnPage({ sessionId, beforeIndex: 2, limit: 10_000 });

      const missing = yield* Effect.exit(
        engine.readTurnPage({ sessionId: SessionId.make("nope"), beforeIndex: 1, limit: 5 })
      );

      return { page, missing };
    }).pipe(Effect.provide(layer()))
  );

  expect(result.page.turns).toHaveLength(2);
  expect(MAX_TURN_PAGE).toBe(50);
  expect(result.missing).toEqual(Exit.fail(new NotFound({ what: "session", id: "nope" })));
}, 30_000);
