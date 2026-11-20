import { expect, test } from "bun:test";
import { join } from "node:path";
import { DomainEvent, SuggestedReplySettings, type Turn } from "@polaris/protocol";
import { Context, Deferred, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { Availability } from "../harness/availability/Availability.ts";
import { tempDir } from "../platform/tempDir.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import type { ReplyBackend } from "./backend.ts";
import { lazySuggestedRepliesWith } from "./lazy.ts";
import { agentSession, report, turn, workspace } from "./testing.ts";

const settings = (enabled: boolean) => SuggestedReplySettings.make({ enabled, fallback: null });

const commitAll = (events: ReadonlyArray<DomainEvent>) =>
  Effect.flatMap(EventStore, (store) =>
    store.commit({ commandId: null, decide: () => Effect.succeed(events) })
  );

const finished = (t: Turn) => [
  DomainEvent.cases.TurnStarted.make({ turn: turn(t.index, "working") }),
  DomainEvent.cases.TurnEnded.make({ turn: t }),
];

test("the fallback starts when the preference is turned on after start-up", async () => {
  const asked: Array<string> = [];

  const backend: ReplyBackend = (harness) =>
    Effect.sync(() => {
      asked.push(harness);

      return { reply: "Go ahead." };
    });

  const program = Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(settings(false));
    const offered = yield* Deferred.make<string>();

    const lazy = lazySuggestedRepliesWith(
      {
        changes: SubscriptionRef.changes(ref),
        settings: SubscriptionRef.get(ref),
        offer: (_, turnId) => Deferred.succeed(offered, turnId).pipe(Effect.asVoid),
      },
      { backend }
    );

    const store = EventStore.layerSqlite(join(tempDir("polaris-lazy-"), "state.sqlite"));

    const availability = Layer.succeed(Availability)(
      Availability.of({ get: () => Effect.succeed(report("codex")), changes: Stream.empty })
    );

    const layer = lazy.pipe(Layer.provideMerge(store), Layer.provide(availability));

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* Layer.build(layer);
        const events = Context.get(built, EventStore);

        const commit = (batch: ReadonlyArray<DomainEvent>) =>
          commitAll(batch).pipe(Effect.provideContext(built));

        yield* commit([
          DomainEvent.cases.WorkspaceRegistered.make({ workspace }),
          DomainEvent.cases.SessionCreated.make({ session: agentSession() }),
          ...finished(turn(0)),
          ...finished(turn(1)),
        ]);

        const followedWhileOff = yield* events.subscriberCount;

        yield* SubscriptionRef.set(ref, settings(true));

        // The writer loads in the background; a Turn that ends once it follows the log is offered.
        while ((yield* events.subscriberCount) === 0) yield* Effect.sleep(1);
        yield* commit(finished(turn(2)));

        return { followedWhileOff, offered: yield* Deferred.await(offered) };
      })
    );
  });

  const { followedWhileOff, offered } = await Effect.runPromise(program);

  expect(followedWhileOff).toBe(0);
  expect(asked).toEqual(["codex"]);
  expect(offered).toBe(turn(2).id);
});
