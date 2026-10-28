/**
 * ENG-495 through the real notifier and `HostPresence`: fakes only at the boundary (the
 * Host stream, read positions and the relay's wake).
 */
import { expect, test } from "bun:test";
import {
  ApprovalDecision,
  DomainEvent,
  type HostStreamItem,
  ReadPosition,
  RequestId,
  TurnId,
} from "@polaris/protocol";
import type { PushMessage } from "@polaris/protocol/relay";
import { Effect, Layer, PubSub, Stream } from "effect";
import { RelayRoute } from "../linkedDevices/route.ts";
import type { PushTarget } from "../linkedDevices/store.ts";
import { HostPresence } from "../presence/index.ts";
import { type Held, settleRead } from "./hold.ts";
import { PushHostEvents, PushNotifier, PushReads } from "./notifier.ts";
import { emptyPlan, planItem, planSettled, type Push, SETTLE_MS } from "./plan.ts";
import {
  approvalRequested,
  event,
  notified,
  SESSION_ID,
  snapshot,
  synchronized,
  turnEnded,
} from "./push.testing.ts";

const unused = Effect.die("not used by the notifier");

// SAFETY: the notifier reads only `registration.automatic`; `wake` below never looks at it.
const target = { device: {}, registration: {} } as PushTarget;

const resolved = (requestId: string) =>
  event(
    DomainEvent.cases.ApprovalResolved.make({
      sessionId: SESSION_ID,
      requestId: RequestId.make(requestId),
      decision: ApprovalDecision.cases.Allow.make({ remember: false }),
      resolvedBy: "MacBook Pro",
    })
  );

/** Runs `body` with a notifier on a fake Host stream; `woken` lists what reached the relay. */
const withNotifier = (
  leaseMs: number,
  body: (input: {
    readonly feed: (item: HostStreamItem) => void;
    readonly presence: HostPresence["Service"];
    readonly woken: ReadonlyArray<PushMessage>;
  }) => Effect.Effect<void>
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<HostStreamItem>();
        const woken: Array<PushMessage> = [];
        const presence = HostPresence.make({ leaseMs });

        const route = RelayRoute.of({
          status: unused,
          enable: () => unused,
          disable: unused,
          startLink: unused,
          awaitLink: () => unused,
          cancelLink: () => unused,
          add: () => unused,
          list: unused,
          unlink: () => unused,
          unlinkSelf: () => unused,
          registerPush: () => unused,
          unregisterPush: () => unused,
          pushTargets: () => [target],
          watchPush: () => () => {},
          host: { hostId: "host-1", hostName: "studio" },
          wake: (_, message) => Effect.sync(() => (woken.push(message), "sent" as const)),
        });

        yield* Layer.build(
          PushNotifier.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(PushHostEvents)({
                  subscribe: () =>
                    Stream.concat(
                      Stream.make(snapshot(), synchronized()),
                      Stream.fromPubSub(events)
                    ),
                }),
                Layer.succeed(PushReads)({ subscribe: () => Stream.never }),
                Layer.succeed(RelayRoute)(route),
                Layer.succeed(HostPresence)(presence)
              )
            )
          )
        );
        // The notifier subscribes in the background.
        yield* Effect.sleep("50 millis");
        yield* body({
          feed: (item) => Effect.runSync(PubSub.publish(events, item)),
          presence,
          woken,
        });
      })
    )
  );

const requestIds = (woken: ReadonlyArray<PushMessage>) => woken.map((m) => m.requestId);

test("while the user is present a Needs You is held, and goes out when they are away", () =>
  withNotifier(60_000, ({ feed, presence, woken }) =>
    Effect.gen(function* () {
      presence.report(1, "present");
      feed(approvalRequested("r1"));
      yield* Effect.sleep("100 millis");
      expect(woken).toEqual([]);

      presence.report(1, "away");
      yield* Effect.sleep("50 millis");
      expect(requestIds(woken)).toEqual(["r1"]);
    })
  ));

test("a request answered at the Mac while held never pushes", () =>
  withNotifier(60_000, ({ feed, presence, woken }) =>
    Effect.gen(function* () {
      presence.report(1, "present");
      feed(approvalRequested("r1"));
      feed(approvalRequested("r2"));
      feed(resolved("r1"));
      yield* Effect.sleep("50 millis");
      presence.report(1, "away");
      yield* Effect.sleep("50 millis");
      expect(requestIds(woken)).toEqual(["r2"]);
    })
  ));

test("a lapsed lease sends what was held, with no away report", () =>
  withNotifier(150, ({ feed, presence, woken }) =>
    Effect.gen(function* () {
      presence.report(1, "present");
      feed(notified("n1", false));
      yield* Effect.sleep("50 millis");
      expect(woken).toEqual([]);
      yield* Effect.sleep("250 millis");
      expect(woken.map((m) => m.kind)).toEqual(["notify"]);
    })
  ));

test("with two Desktop Apps the Host stays quiet until both are away", () =>
  withNotifier(60_000, ({ feed, presence, woken }) =>
    Effect.gen(function* () {
      presence.report(1, "present");
      presence.report(2, "present");
      feed(approvalRequested("r1"));
      presence.report(1, "away");
      yield* Effect.sleep("50 millis");
      expect(woken).toEqual([]);
      presence.disconnect(2);
      yield* Effect.sleep("50 millis");
      expect(requestIds(woken)).toEqual(["r1"]);
    })
  ));

const host = { hostId: "host-1", hostName: "studio" };

/** A finished Turn (index 0) and an agent's notification, as the plan pushes them, held. */
const heldPushes = (): Held => {
  let state = emptyPlan;
  const held: Array<Push> = [];

  for (const item of [
    snapshot(),
    synchronized(),
    notified("n1", false),
    turnEnded("t1", "All green"),
  ]) {
    const planned = planItem(state, item, { ...host, now: 1_000 });
    state = planned.state;
    held.push(...planned.send);
  }

  held.push(...planSettled(state, { ...host, now: 1_000 + SETTLE_MS }).send);

  return held;
};

const read = (turnIndex: number, at: number) =>
  new ReadPosition({
    sessionId: SESSION_ID,
    turnId: TurnId.make("t1"),
    turnIndex,
    at: new Date(at).toISOString(),
  });

const kinds = (held: Held) => held.map(({ message }) => message.kind);

test("reading the session through a finished Turn handles it and the notification before it", () => {
  expect(kinds(heldPushes())).toEqual(["notify", "turn-ended"]);
  expect(kinds(settleRead(heldPushes(), read(0, 5_000)))).toEqual([]);
});

test("a read from before the Turn or the notification handles neither", () => {
  expect(kinds(settleRead(heldPushes(), read(-1, 500)))).toEqual(["notify", "turn-ended"]);
});
