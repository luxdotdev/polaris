import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Actor,
  type Capability,
  Command,
  DomainEvent,
  PersonId,
  SessionId,
  SessionPlacement,
  Share,
  ShareId,
  SharePerson,
  ShareTarget,
  TurnId,
} from "@polaris/protocol";
import { Effect, Layer, Predicate, Stream } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { ShareBook } from "../shares/identities.ts";
import { EventStore } from "../store/EventStore.ts";
import { queueOf } from "../store/queuedTurns.ts";
import { actorSessionItemsFor } from "./actorCompat.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  type FakeDriver,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts";

type Env = Engine | EventStore;

const S = SessionId.make("s-queue");

const OWNER = Actor.cases.Client.make({});

const share = (name: string) =>
  new Share({
    id: ShareId.make(`share-${name}`),
    target: ShareTarget.cases.Session.make({ sessionId: S }),
    issuer: "https://accounts.example",
    person: new SharePerson({
      id: PersonId.make(`person-${name}`),
      login: name.toLowerCase(),
      name,
      avatarUrl: null,
      commitEmail: null,
    }),
    role: "contributor",
    grant: ["read", "comment", "approve", "turn"],
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    revokedAt: null,
  });

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const ana = teammate("Ana");

const bob = teammate("Bob");

/** An Engine whose Host has `shares`; the fake Harness ends a Turn only when the test says. */
const setup = (shares: ReadonlyArray<Share>, onInterrupt = false) => {
  const driver = makeFakeDriver(
    "claude",
    onInterrupt
      ? {
          onInterrupt: (session) => [
            HarnessEvent.TurnEnded({
              turnId: session.turns.at(-1)!.turnId,
              status: "interrupted",
              error: null,
            }),
          ],
        }
      : {}
  );

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  }).pipe(Layer.provide(Layer.succeed(ShareBook)({ all: Effect.succeed(shares), bind: () => {} })));

  return { driver, layer };
};

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command, actor: Actor = OWNER) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid("queue"), command, deviceLabel: "MacBook", actor })
  );

const rejection = (command: Command, actor: Actor = OWNER) =>
  Effect.flip(dispatch(command, actor)).pipe(
    Effect.map((error) =>
      Predicate.isTagged(error, "CommandRejected") ? error.reason : error._tag
    )
  );

const send = (prompt: string, actor: Actor = OWNER) =>
  dispatch(Command.cases.SendTurn.make({ sessionId: S, prompt, attachments: [] }), actor);

const record = Effect.map(
  Effect.flatMap(EventStore, (store) => store.model),
  (model) => model.sessions.get(S)!
);

const queue = Effect.map(record, (r) => queueOf(r).map((q) => [q.prompt, q.actor] as const));

const queuedId = (prompt: string) =>
  Effect.map(record, (r) => queueOf(r).find((q) => q.prompt === prompt)!.id);

/** A session whose first Turn is with the Harness, still working. */
const working = (driver: FakeDriver) =>
  Effect.gen(function* () {
    const repo = fakeRepo();
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => m.workspaces.size > 0);
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId: S,
        workspaceId: [...model.workspaces.keys()][0]!,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "first",
        attachments: [],
      })
    );
    yield* waitUntil(() => driver.latest(S)?.turns.length === 1);
    yield* waitFor((m) => m.sessions.get(S)?.session.state === "working");
  });

/** The Harness ends the Turn it was last handed. */
const endTurn = (driver: FakeDriver, status: "completed" | "failed" = "completed") =>
  Effect.sync(() => {
    const harness = driver.latest(S)!;
    harness.emit(
      HarnessEvent.TurnEnded({
        turnId: harness.turns.at(-1)!.turnId,
        status,
        error: status === "failed" ? "the model call failed" : null,
      })
    );
  });

const handed = (driver: FakeDriver, count: number) =>
  waitUntil(() => driver.latest(S)?.turns.length === count, 2000, `${count} Turns handed over`);

const prompts = (driver: FakeDriver) => driver.latest(S)!.turns.map((turn) => turn.prompt);

describe("queued Turns in a shared session (ENG-941)", () => {
  test("Turns two people send while one works run in arrival order, each with its Actor", async () => {
    const { driver, layer } = setup([share("Ana"), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        yield* send("from Bob", bob);
        yield* send("from the owner");

        // The owner's Turn waits behind the Teammates': no owner priority.
        expect(yield* queue).toEqual([
          ["from Ana", ana],
          ["from Bob", bob],
          ["from the owner", OWNER],
        ]);
        expect(prompts(driver)).toEqual(["first"]);

        yield* endTurn(driver);
        yield* handed(driver, 2);
        // Ana's Turn is in flight and the session never went Idle between the two.
        const second = yield* record;
        expect(second.session.state).toBe("working");
        expect(second.turns.at(-1)).toMatchObject({ prompt: "from Ana", status: "working" });
        expect(yield* queue).toEqual([
          ["from Bob", bob],
          ["from the owner", OWNER],
        ]);

        yield* endTurn(driver);
        yield* handed(driver, 3);
        yield* endTurn(driver);
        yield* handed(driver, 4);
        yield* endTurn(driver);
        const done = yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

        expect(prompts(driver)).toEqual(["first", "from Ana", "from Bob", "from the owner"]);
        expect(done.sessions.get(S)!.turns.map((t) => [t.index, t.status, t.actor])).toEqual([
          [0, "completed", OWNER],
          [1, "completed", ana],
          [2, "completed", bob],
          [3, "completed", OWNER],
        ]);
        expect(yield* queue).toEqual([]);

        const store = yield* EventStore;
        const log = yield* store.readEvents({ after: 0, upTo: done.sequence, sessionId: S });

        const states = log.flatMap(({ event }) =>
          DomainEvent.guards.SessionStateChanged(event) ? [event.state] : []
        );

        // Working once for the whole run of Turns, Idle only after the last.
        expect(states.filter((state) => state === "idle")).toEqual(["idle"]);
      })
    );
  });

  test("a session nobody shares still refuses a Turn sent while it works", async () => {
    const { driver, layer } = setup([]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        expect(
          yield* rejection(
            Command.cases.SendTurn.make({ sessionId: S, prompt: "x", attachments: [] })
          )
        ).toBe("the session is working; wait for the Turn to end");
        expect(yield* queue).toEqual([]);
      })
    );
  });

  test("its author or the owner cancels a queued Turn; another Teammate is refused", async () => {
    const { driver, layer } = setup([share("Ana"), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("Ana's first", ana);
        yield* send("Bob's", bob);
        yield* send("Ana's second", ana);

        const cancel = (turnId: TurnId) =>
          Command.cases.CancelQueuedTurn.make({ sessionId: S, turnId });

        const anasFirst = yield* queuedId("Ana's first");
        const bobs = yield* queuedId("Bob's");

        expect(yield* rejection(cancel(anasFirst), bob)).toBe(
          "only its author or the session's owner can cancel a queued Turn"
        );
        expect((yield* queue).map(([prompt]) => prompt)).toEqual([
          "Ana's first",
          "Bob's",
          "Ana's second",
        ]);

        yield* dispatch(cancel(anasFirst), ana);
        yield* dispatch(cancel(bobs));
        expect(yield* queue).toEqual([["Ana's second", ana]]);
        expect(yield* rejection(cancel(bobs))).toBe("that Turn is no longer queued");

        yield* endTurn(driver);
        yield* handed(driver, 2);
        // Once started it is a Turn, not a queued one.
        expect(yield* rejection(cancel(driver.latest(S)!.turns[1]!.turnId), ana)).toBe(
          "that Turn is no longer queued"
        );
        yield* endTurn(driver);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
        // The cancelled Turns never reached the Harness.
        expect(prompts(driver)).toEqual(["first", "Ana's second"]);
      })
    );
  });

  test("an edit by its author or the owner is what the Harness gets; another Teammate's is refused", async () => {
    const { driver, layer } = setup([share("Ana"), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("draft", ana);
        yield* send("Bob's", bob);
        const turnId = yield* queuedId("draft");

        const edit = (prompt: string) =>
          Command.cases.EditQueuedTurn.make({ sessionId: S, turnId, prompt });

        expect(yield* rejection(edit("hijacked"), bob)).toBe(
          "only its author or the session's owner can edit a queued Turn"
        );
        expect(yield* rejection(edit("  "), ana)).toBe("the prompt is empty");
        yield* dispatch(edit("final"), ana);

        // It keeps its place and its author.
        expect(yield* queue).toEqual([
          ["final", ana],
          ["Bob's", bob],
        ]);

        yield* endTurn(driver);
        yield* handed(driver, 2);
        expect(prompts(driver)).toEqual(["first", "final"]);
        expect((yield* record).turns.at(-1)).toMatchObject({ id: turnId, actor: ana });
      })
    );
  });

  test("an interrupted Turn makes way for the next queued one", async () => {
    const { driver, layer } = setup([share("Ana")], true);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("next", ana);
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }), ana);
        yield* handed(driver, 2);

        const now = yield* record;
        expect(now.turns.map((t) => [t.prompt, t.status])).toEqual([
          ["first", "interrupted"],
          ["next", "working"],
        ]);
        expect(now.session.state).toBe("working");
      })
    );
  });

  test("a Turn that fails drops the queue, and each dropped Turn says why", async () => {
    const { driver, layer } = setup([share("Ana")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("never runs", ana);
        const turnId = yield* queuedId("never runs");
        yield* endTurn(driver, "failed");
        const failed = yield* waitFor((m) => m.sessions.get(S)?.session.state === "failed");

        expect(yield* queue).toEqual([]);
        expect(prompts(driver)).toEqual(["first"]);

        const store = yield* EventStore;
        const log = yield* store.readEvents({ after: 0, upTo: failed.sequence, sessionId: S });

        expect(
          log.flatMap(({ event }) => (DomainEvent.guards.QueuedTurnCancelled(event) ? [event] : []))
        ).toEqual([
          DomainEvent.cases.QueuedTurnCancelled.make({
            sessionId: S,
            turnId,
            actor: null,
            reason: "the model call failed",
          }),
        ]);
      })
    );
  });

  test("the queue survives in the store, and a restart drops it with the Turn in flight", async () => {
    const { driver, layer } = setup([share("Ana")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("queued before the restart", ana);
      })
    );

    // A second run over the same database is a Daemon restart: the queue loads from SQL.
    const after = await run(
      layer,
      Effect.gen(function* () {
        const model = yield* waitFor((m) => m.sessions.get(S)?.session.state === "needs-you");
        const store = yield* EventStore;
        const log = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: S });

        return {
          queue: yield* queue,
          dropped: log.flatMap(({ event }) =>
            DomainEvent.guards.QueuedTurnCancelled(event) ? [event.reason] : []
          ),
        };
      })
    );

    expect(after.queue).toEqual([]);
    expect(after.dropped).toEqual(["The Daemon restarted"]);
  });

  test("the queue reaches only Clients that announced session.queued-turns", async () => {
    const { driver, layer } = setup([share("Ana")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("waiting", ana);
        const engine = yield* Engine;

        const snapshotFor = (capabilities: ReadonlyArray<Capability>) =>
          engine
            .subscribeSession({ sessionId: S, afterSequence: null, turnLimit: null, capabilities })
            .pipe(
              Stream.take(1),
              Stream.runCollect,
              // The RPC handler rewrites Actors for the Client, as here.
              Effect.map(([sent]) => {
                const item =
                  sent === undefined ? sent : (actorSessionItemsFor(capabilities)?.(sent) ?? sent);

                return item !== undefined && Predicate.isTagged(item, "Snapshot")
                  ? item.queuedTurns.map((q) => [q.prompt, q.actor])
                  : null;
              })
            );

        const decodesAll: ReadonlyArray<Capability> = [
          "session.queued-turns",
          "actor.teammate",
          "actor.linked-device",
        ];

        expect(yield* snapshotFor(decodesAll)).toEqual([["waiting", ana]]);
        // Without `actor.teammate` the author reads as a Client; without the capability, nothing.
        expect(yield* snapshotFor(["session.queued-turns"])).toEqual([["waiting", OWNER]]);
        expect(yield* snapshotFor([])).toEqual([]);
      })
    );
  });
});
