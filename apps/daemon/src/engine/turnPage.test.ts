/** `session.turns`: older Turns a page at a time, for a Client that opened on the latest few. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  encodeJsonFrame,
  NotFound,
  SessionId,
  SessionPlacement,
  SessionStreamItem,
} from "@polaris/protocol";
import { Effect, Exit, Option, Predicate, Schema, Stream } from "effect";
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

const withTurns = (turns: number, pad = "") =>
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
        prompt: `turn 0${pad}`,
        attachments: [],
      })
    );

    for (let i = 1; i < turns; i++) {
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
      yield* dispatch(
        Command.cases.SendTurn.make({ sessionId, prompt: `turn ${i}${pad}`, attachments: [] })
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

test("a page holds at most MAX_TURN_PAGE Turns, however many the Client asks for", async () => {
  const page = await Effect.runPromise(
    Effect.gen(function* () {
      yield* withTurns(MAX_TURN_PAGE + 1);
      const engine = yield* Engine;

      return yield* engine.readTurnPage({
        sessionId,
        beforeIndex: MAX_TURN_PAGE + 1,
        limit: 10_000,
      });
    }).pipe(Effect.provide(layer()))
  );

  expect(page.turns).toHaveLength(MAX_TURN_PAGE);
  expect(page.turns[0]?.turn.index).toBe(1);
  expect(page.turns.at(-1)?.turn.index).toBe(MAX_TURN_PAGE);
  expect(page.hasMore).toBe(true);
}, 30_000);

const encodeItem = Schema.encodeSync(Schema.toCodecJson(SessionStreamItem));

// ENG-535: a long session's Snapshot passed the 16 MB frame, and the phone never opened it.
test("a Snapshot and a page past a frame's worth keep the newest Turns that fit", async () => {
  const { snapshot, page } = await Effect.runPromise(
    Effect.gen(function* () {
      // The prompt shows twice in a Turn (its prompt and its first item): about 3 MB each, 21 in all.
      yield* withTurns(7, "x".repeat(1536 * 1024));
      const engine = yield* Engine;

      const first = yield* engine
        .subscribeSession({ sessionId, afterSequence: null, turnLimit: null })
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow));

      return {
        snapshot: first,
        page: yield* engine.readTurnPage({ sessionId, beforeIndex: 7, limit: 7 }),
      };
    }).pipe(Effect.provide(layer()))
  );

  if (!Predicate.isTagged(snapshot, "Snapshot")) throw new Error("expected a Snapshot first");
  expect(snapshot.turns.map((t) => t.turn.index)).toEqual([5, 6]);
  expect(() => encodeJsonFrame(JSON.stringify(encodeItem(snapshot)))).not.toThrow();
  expect(page.turns.map((t) => t.turn.index)).toEqual([5, 6]);
  expect(page.hasMore).toBe(true);
}, 60_000);

test("an unknown session is NotFound", async () => {
  const missing = await Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* Engine;

      return yield* Effect.exit(
        engine.readTurnPage({ sessionId: SessionId.make("nope"), beforeIndex: 1, limit: 5 })
      );
    }).pipe(Effect.provide(layer()))
  );

  expect(missing).toEqual(Exit.fail(new NotFound({ what: "session", id: "nope" })));
});
