import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Actor,
  ApprovalDecision,
  type Capability,
  Command,
  DomainEvent,
  type Grant,
  Pairing,
  PairingId,
  PersonId,
  RequestId,
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
import { PairingBook } from "./queueAccess.ts";
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

const CONTRIBUTOR: Grant = ["read", "comment", "approve", "turn"];

const share = (name: string, revokedAt: string | null = null, grant: Grant = CONTRIBUTOR) =>
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
    grant,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    revokedAt,
  });

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const raycast = Actor.cases.Extension.make({ pairingId: PairingId.make("p1"), name: "Raycast" });

const pairing = (revokedAt: string | null, grant: Grant = ["read", "turn"]) =>
  new Pairing({
    id: PairingId.make("p1"),
    name: "Raycast",
    grant,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt,
  });

const ana = teammate("Ana");

const bob = teammate("Bob");

/** An Engine whose Host has `shares`; the fake Harness ends a Turn only when the test says. */
const setup = (shares: ReadonlyArray<Share>, onInterrupt = false) => {
  let current = shares;
  let pairings: ReadonlyArray<Pairing> | null = null;

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
  }).pipe(
    Layer.provide(Layer.succeed(ShareBook)({ all: Effect.sync(() => current), bind: () => {} })),
    Layer.provide(Layer.succeed(PairingBook)({ all: Effect.sync(() => pairings), bind: () => {} }))
  );

  /** The owner revokes `name`'s Share. */
  const revoke = (name: string) => {
    current = current.map((s) =>
      s.person.name === name ? share(name, "2026-06-01T00:00:00.000Z") : s
    );
  };

  /** The owner makes `name` a Commenter: their Share no longer holds `turn`. */
  const demote = (name: string) => {
    current = current.map((s) =>
      s.person.name === name ? share(name, null, ["read", "comment"]) : s
    );
  };

  /** The owner changes `name`'s Share to hold `grant`. */
  const regrant = (name: string, grant: Grant) => {
    current = current.map((s) => (s.person.name === name ? share(name, null, grant) : s));
  };

  /** What the Pairing store holds from now on. */
  const paired = (now: ReadonlyArray<Pairing>) => {
    pairings = now;
  };

  return { driver, layer, revoke, demote, regrant, paired };
};

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command, actor: Actor = OWNER, extensionGrant: Grant | null = null) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({
      commandId: cid("queue"),
      command,
      deviceLabel: "MacBook",
      actor,
      extensionGrant,
    })
  );

const cancellations = (upTo: number) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const log = yield* store.readEvents({ after: 0, upTo, sessionId: S });

    return log.flatMap(({ event }) =>
      DomainEvent.guards.QueuedTurnCancelled(event) ? [[event.turnId, event.reason]] : []
    );
  });

const rejection = (command: Command, actor: Actor = OWNER, grant: Grant | null = null) =>
  Effect.flip(dispatch(command, actor, grant)).pipe(
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

  test("an Interrupt pauses the queue; a Turn sent then joins the back; a resume starts the head as its sender's", async () => {
    const { driver, layer } = setup([share("Ana"), share("Bob")], true);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        yield* send("from Bob", bob);
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }), ana);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

        // Stop started nobody's Turn, and a Turn sent now waits behind the others.
        yield* send("from the owner");
        expect(prompts(driver)).toEqual(["first"]);
        expect((yield* record).session.state).toBe("idle");
        expect(yield* queue).toEqual([
          ["from Ana", ana],
          ["from Bob", bob],
          ["from the owner", OWNER],
        ]);

        const resume = Command.cases.ResumeQueue.make({ sessionId: S });
        const bobs = yield* queuedId("from Bob");
        yield* dispatch(Command.cases.CancelQueuedTurn.make({ sessionId: S, turnId: bobs }), bob);
        yield* dispatch(resume, bob);
        yield* handed(driver, 2);

        // Bob resumed; the Turn is Ana's.
        expect((yield* record).turns.at(-1)).toMatchObject({
          prompt: "from Ana",
          status: "working",
          actor: ana,
        });
        expect(yield* rejection(resume)).toBe("a Turn is working; the queue is not paused");

        // The queue runs on from there.
        yield* endTurn(driver);
        yield* handed(driver, 3);
        yield* endTurn(driver);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
        expect(prompts(driver)).toEqual(["first", "from Ana", "from the owner"]);
        expect(yield* rejection(resume)).toBe("no Turns are queued");
      })
    );
  });

  test("a queued Turn starts only if its sender may still send one: an unpaired Extension and a Commenter may not", async () => {
    const { driver, layer, demote, paired } = setup([share("Ana"), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        paired([pairing(null)]);
        yield* working(driver);

        const fromRaycast = Command.cases.SendTurn.make({
          sessionId: S,
          prompt: "from Raycast",
          attachments: [],
        });

        yield* dispatch(fromRaycast, raycast, ["read", "turn"]);
        yield* send("from Ana", ana);
        yield* send("from Bob", bob);
        const raycasts = yield* queuedId("from Raycast");
        const anas = yield* queuedId("from Ana");

        paired([pairing("2026-06-01T00:00:00.000Z")]);
        demote("Ana");
        yield* endTurn(driver);
        yield* handed(driver, 2);

        expect(prompts(driver)).toEqual(["first", "from Bob"]);
        const model = yield* Effect.flatMap(EventStore, (store) => store.model);
        expect(yield* cancellations(model.sequence)).toEqual([
          [raycasts, "Its extension was unpaired"],
          [anas, "Their share no longer allows turns"],
        ]);
      })
    );
  });

  test("a resume checks the senders too: a paused Turn whose Share ended is cancelled, not started", async () => {
    const { driver, layer, revoke } = setup([share("Ana")], true);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        const turnId = yield* queuedId("from Ana");
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }));
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
        revoke("Ana");
        yield* dispatch(Command.cases.ResumeQueue.make({ sessionId: S }));

        const model = yield* Effect.flatMap(EventStore, (store) => store.model);
        expect(model.sessions.get(S)!.session.state).toBe("idle");
        expect(prompts(driver)).toEqual(["first"]);
        expect(yield* cancellations(model.sequence)).toEqual([[turnId, "Their share ended"]]);
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

  test("a Turn queued through a Share that ended since never starts; the next one does", async () => {
    const { driver, layer, revoke } = setup([share("Ana"), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        yield* send("from Bob", bob);
        const turnId = yield* queuedId("from Ana");
        revoke("Ana");
        yield* endTurn(driver);
        yield* handed(driver, 2);

        expect(prompts(driver)).toEqual(["first", "from Bob"]);
        expect(yield* queue).toEqual([]);
        const model = yield* Effect.flatMap(EventStore, (store) => store.model);
        expect(yield* cancellations(model.sequence)).toEqual([[turnId, "Their share ended"]]);
      })
    );
  });

  test("a Turn queued without approve never starts once the session approves for itself", async () => {
    const { driver, layer } = setup([share("Ana")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);

        const sendTurn = Command.cases.SendTurn.make({
          sessionId: S,
          prompt: "from Raycast",
          attachments: [],
        });

        yield* dispatch(sendTurn, raycast, ["read", "turn"]);
        const turnId = yield* queuedId("from Raycast");
        // The owner's edit keeps it the Extension's Turn, sent without `approve`.
        yield* dispatch(
          Command.cases.EditQueuedTurn.make({ sessionId: S, turnId, prompt: "reworded" })
        );
        yield* dispatch(
          Command.cases.SetPermissionMode.make({ sessionId: S, permissionMode: "auto" })
        );
        yield* endTurn(driver);
        const idle = yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

        expect(prompts(driver)).toEqual(["first"]);
        expect(yield* cancellations(idle.sequence)).toEqual([
          [turnId, "The session approves for itself now, and its sender can't approve"],
        ]);
      })
    );
  });

  const NO_APPROVE: Grant = ["read", "comment", "turn"];
  const autoMode = Command.cases.SetPermissionMode.make({ sessionId: S, permissionMode: "auto" });

  test.each([
    ["an Extension whose Pairing", "Its extension may no longer approve"],
    ["a Teammate whose Share", "Their share no longer allows approving"],
  ] as const)(
    "%s loses approve while its Turn waits: it never starts once the session approves for itself",
    async (who, reason) => {
      const fromExtension = who.startsWith("an Extension");
      const { driver, layer, regrant, paired } = setup([share("Ana")]);

      await run(
        layer,
        Effect.gen(function* () {
          paired([pairing(null, ["read", "turn", "approve"])]);
          yield* working(driver);
          yield* dispatch(autoMode);

          const sendTurn = Command.cases.SendTurn.make({
            sessionId: S,
            prompt: "queued",
            attachments: [],
          });

          if (fromExtension) yield* dispatch(sendTurn, raycast, ["read", "turn", "approve"]);
          else yield* send("queued", ana);
          const turnId = yield* queuedId("queued");

          if (fromExtension) paired([pairing(null, ["read", "turn"])]);
          else regrant("Ana", NO_APPROVE);
          yield* endTurn(driver);
          const idle = yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

          expect(prompts(driver)).toEqual(["first"]);
          expect(yield* cancellations(idle.sequence)).toEqual([[turnId, reason]]);
        })
      );
    }
  );

  test("a Teammate whose Share lacks approve queues their Turn without it, whatever Grant reached the Engine", async () => {
    const { driver, layer } = setup([share("Ana", null, NO_APPROVE), share("Bob")]);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        yield* send("from Bob", bob);
        expect(queueOf(yield* record).map((q) => [q.prompt, q.approves])).toEqual([
          ["from Ana", false],
          ["from Bob", true],
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

  test("a Teammate's approval answer starts nothing: the queue waits behind the Turn, and stays paused after an Interrupt", async () => {
    const { driver, layer } = setup([share("Ana"), share("Bob")], true);

    const ask = (requestId: RequestId) =>
      Effect.sync(() => {
        const harness = driver.latest(S)!;
        harness.emit(
          HarnessEvent.ApprovalRequested({
            turnId: harness.turns.at(-1)!.turnId,
            requestId,
            kind: "command",
            title: "Run bun test",
            detail: null,
            options: [],
          })
        );
      });

    const allow = (requestId: RequestId) =>
      Command.cases.RespondToApproval.make({
        sessionId: S,
        requestId,
        decision: ApprovalDecision.cases.Allow.make({ remember: false }),
      });

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("from Ana", ana);
        const first = RequestId.make("req-queue-1");
        yield* ask(first);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "needs-you");
        yield* dispatch(allow(first), bob, CONTRIBUTOR);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "working");

        // Bob's answer put the first Turn back to work; Ana's still waits behind it.
        expect(prompts(driver)).toEqual(["first"]);
        expect(yield* queue).toEqual([["from Ana", ana]]);

        const second = RequestId.make("req-queue-2");
        yield* ask(second);
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "needs-you");
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }));
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

        // The Interrupt withdrew the request; answering it now resumes nothing.
        expect(yield* rejection(allow(second), bob, CONTRIBUTOR)).toBe(
          `request ${second} is already resolved`
        );
        expect((yield* record).session.state).toBe("idle");
        expect(prompts(driver)).toEqual(["first"]);
        expect(yield* queue).toEqual([["from Ana", ana]]);
      })
    );
  });

  test("archiving a session cancels its paused queue", async () => {
    const { driver, layer } = setup([share("Ana")], true);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("never runs", ana);
        const turnId = yield* queuedId("never runs");
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }));
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
        yield* dispatch(
          Command.cases.ArchiveSession.make({ sessionId: S, deleteMergedBranch: false })
        );
        const model = yield* waitFor((m) => m.sessions.get(S)?.session.state === "archived");

        expect(yield* queue).toEqual([]);
        expect(yield* cancellations(model.sequence)).toEqual([
          [turnId, "The session was archived"],
        ]);
      })
    );
  });

  test("a paused queue survives a restart, and a resume then starts its head", async () => {
    const { driver, layer } = setup([share("Ana")], true);

    await run(
      layer,
      Effect.gen(function* () {
        yield* working(driver);
        yield* send("paused before the restart", ana);
        yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }));
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
      })
    );

    const after = await run(
      layer,
      Effect.gen(function* () {
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "dormant");
        const kept = yield* queue;
        yield* dispatch(Command.cases.ResumeQueue.make({ sessionId: S }));
        yield* waitUntil(
          () => driver.latest(S)?.turns.at(-1)?.prompt === "paused before the restart"
        );

        return { kept, last: (yield* record).turns.at(-1) };
      })
    );

    expect(after.kept).toEqual([["paused before the restart", ana]]);
    expect(after.last).toMatchObject({ status: "working", actor: ana });
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
