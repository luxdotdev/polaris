import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  DomainEvent,
  SessionId,
  SessionPlacement,
  type SessionStreamItem,
  SubagentId,
  type TurnId,
  TurnItem,
} from "@polaris/protocol";
import { Duration, Effect, Fiber, type Layer, Predicate, Stream } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
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

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const SUB = SubagentId.make("sub-1");

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "test" })
  );

const layerWith = (driver: FakeDriver) =>
  engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  });

/** A Codex-like session with its first Turn in flight; returns the Turn's id. */
const startWorking = (driver: FakeDriver, sessionId: SessionId) =>
  Effect.gen(function* () {
    const repo = fakeRepo();
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => m.workspaces.size > 0);
    const workspace = [...model.workspaces.values()][0]!;
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "codex",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "go",
        attachments: [],
      })
    );
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");

    return driver.latest(sessionId)!.turns[0]!.turnId;
  });

const spawn = (turnId: TurnId) =>
  HarnessEvent.SubagentStarted({
    turnId,
    subagentId: SUB,
    parentItemId: "call-1",
    title: "Check frame timing",
    agent: "Explore",
    model: "haiku",
  });

const subItem = (turnId: TurnId) =>
  HarnessEvent.ItemCompleted({
    turnId,
    subagentId: SUB,
    item: TurnItem.cases.AssistantMessage.make({ id: "sub-m1", text: "measured" }),
  });

/** Everything a session stream sends, for Clients with and without `session.subagents`. */
const collect = (sessionId: SessionId, subagents: boolean) =>
  Effect.gen(function* () {
    const engine = yield* Engine;
    const items: Array<SessionStreamItem> = [];

    const fiber = yield* Stream.runForEach(
      engine.subscribeSession({ sessionId, afterSequence: null, turnLimit: null, subagents }),
      (item) => Effect.sync(() => void items.push(item))
    ).pipe(Effect.forkChild);

    yield* waitUntil(() => items.some((i) => Predicate.isTagged(i, "Synchronized")));

    return { items, stop: Fiber.interrupt(fiber) };
  });

const tags = (items: ReadonlyArray<SessionStreamItem>) =>
  items.flatMap((i) => {
    if (Predicate.isTagged(i, "Event")) return [i.envelope.event._tag];

    return Predicate.isTagged(i, "Delta") ? [`Delta:${i.subagentId ?? "turn"}`] : [];
  });

describe("Subagents", () => {
  test("recorded with their own items; only Clients that announced them see them", async () => {
    const codex = makeFakeDriver("codex");
    await run(
      layerWith(codex),
      Effect.gen(function* () {
        const s = SessionId.make("s-sub");
        const turnId = yield* startWorking(codex, s);
        const withSubagents = yield* collect(s, true);
        const without = yield* collect(s, false);
        const harness = codex.latest(s)!;

        harness.emit(
          spawn(turnId),
          HarnessEvent.ItemDelta({
            turnId,
            subagentId: SUB,
            itemId: "sub-m1",
            field: "text",
            text: "me",
          }),
          subItem(turnId),
          HarnessEvent.ItemDelta({ turnId, itemId: "m1", field: "text", text: "ok" })
        );
        const opened = yield* waitFor((m) => m.sessions.get(s)?.subagents.has(SUB) === true);
        expect(opened.sessions.get(s)!.subagents.get(SUB)).toMatchObject({ status: "working" });

        harness.emit(
          HarnessEvent.SubagentEnded({ subagentId: SUB, status: "completed" }),
          HarnessEvent.TurnEnded({ turnId, status: "completed", error: null })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        yield* Effect.sleep(Duration.millis(20));
        yield* withSubagents.stop;
        yield* without.stop;

        expect(tags(withSubagents.items)).toEqual([
          "SubagentStarted",
          `Delta:${SUB}`,
          "TurnItemCompleted",
          "Delta:turn",
          "SubagentEnded",
          "CheckpointRecorded",
          "TurnEnded",
          "SessionStateChanged",
        ]);
        expect(tags(without.items)).toEqual([
          "Delta:turn",
          "CheckpointRecorded",
          "TurnEnded",
          "SessionStateChanged",
        ]);

        // A fresh snapshot: the Subagent under its Turn with its own items, only for those Clients.
        const again = yield* collect(s, true);
        const plain = yield* collect(s, false);
        yield* again.stop;
        yield* plain.stop;
        const [snapshot] = again.items;
        const [plainSnapshot] = plain.items;

        if (
          !Predicate.isTagged(snapshot, "Snapshot") ||
          !Predicate.isTagged(plainSnapshot, "Snapshot")
        )
          throw new Error("no snapshot");
        const [detail] = snapshot.turns[0]!.subagents;
        expect(detail?.subagent).toMatchObject({
          id: SUB,
          turnId,
          parentItemId: "call-1",
          title: "Check frame timing",
          status: "completed",
        });
        expect(detail?.items.map((i) => i.id)).toEqual(["sub-m1"]);
        expect(snapshot.turns[0]!.items.map((i) => i.id)).not.toContain("sub-m1");
        expect(plainSnapshot.turns[0]!.subagents).toEqual([]);
        expect(plainSnapshot.turns[0]!.items.map((i) => i.id)).not.toContain("sub-m1");
      })
    );
  });

  test("a Subagent may outlive its Turn; the Harness exiting ends what is left", async () => {
    const codex = makeFakeDriver("codex");
    await run(
      layerWith(codex),
      Effect.gen(function* () {
        const s = SessionId.make("s-outlive");
        const turnId = yield* startWorking(codex, s);
        const harness = codex.latest(s)!;
        harness.emit(
          spawn(turnId),
          HarnessEvent.TurnEnded({ turnId, status: "completed", error: null })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        // Still working after its Turn, and its items still arrive.
        harness.emit(subItem(turnId));
        const idle = yield* waitFor((m) => m.sessions.get(s)?.subagents.has(SUB) === true);
        expect(idle.sessions.get(s)!.subagents.get(SUB)?.status).toBe("working");

        harness.emit(HarnessEvent.Exited({ error: null }));
        const closed = yield* waitFor((m) => m.sessions.get(s)?.subagents.size === 0);
        expect(closed.sessions.get(s)!.session.state).toBe("dormant");

        const store = yield* EventStore;
        const events = yield* store.readEvents({ after: 0, upTo: closed.sequence, sessionId: s });
        const ended = events.map((e) => e.event).find(DomainEvent.guards.SubagentEnded);
        expect(ended?.subagent).toMatchObject({ id: SUB, status: "interrupted" });
        expect(ended?.subagent.endedAt).not.toBeNull();
      })
    );
  });

  test("a Subagent for a Turn that isn't in flight, or a repeat, is ignored", async () => {
    const codex = makeFakeDriver("codex");
    await run(
      layerWith(codex),
      Effect.gen(function* () {
        const s = SessionId.make("s-stale");
        const turnId = yield* startWorking(codex, s);
        const harness = codex.latest(s)!;
        harness.emit(HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }));
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        harness.emit(
          spawn(turnId),
          HarnessEvent.SubagentEnded({ subagentId: SUB, status: "completed" })
        );
        yield* Effect.sleep(Duration.millis(30));

        const store = yield* EventStore;
        const model = yield* store.model;
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: s });
        expect(events.some((e) => e.event._tag.startsWith("Subagent"))).toBe(false);
      })
    );
  });
});
