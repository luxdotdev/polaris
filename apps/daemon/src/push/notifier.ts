/**
 * Pushes Needs You, notifications and finished Turns to Linked Devices registered for push
 * (apps/relay README: Push). It follows the Engine's Host stream only while some device is
 * registered, so a Host without one pays nothing; a timer runs only while a Turn settles.
 * While the user is at a Desktop App (`HostPresence`) pushes are held, not sent (`hold.ts`).
 */
import {
  type Capability,
  ContinuityItem,
  type HostStreamItem,
  type ReadPosition,
} from "@polaris/protocol";
import { Context, Effect, Fiber, Layer, Stream } from "effect";
import { Continuity } from "../continuity/index.ts";
import { Engine } from "../engine/Engine.ts";
import { RelayRoute } from "../linkedDevices/route.ts";
import { HostPresence } from "../presence/index.ts";
import { type Held, hold, settleItem, settleRead } from "./hold.ts";
import { emptyPlan, nextSettle, type PlanState, planItem, planSettled, type Push } from "./plan.ts";

/** What the plan reads beyond the base Host stream. */
const PUSH_CAPABILITIES: ReadonlyArray<Capability> = ["session.notify", "constellation"];

/** The Host stream the notifier follows: the Engine's, from now. */
export class PushHostEvents extends Context.Service<
  PushHostEvents,
  { readonly subscribe: () => Stream.Stream<HostStreamItem> }
>()("polaris/daemon/push/PushHostEvents") {
  static readonly engine = Layer.effect(
    PushHostEvents,
    Effect.gen(function* () {
      const engine = yield* Engine;

      // Without these the Host stream leaves out `SessionNotified` and the Constellation events.
      return PushHostEvents.of({
        subscribe: () => engine.subscribeHost(null, { capabilities: PUSH_CAPABILITIES }),
      });
    })
  );
}

/** Every session's read position, then each move: followed only while a push is held. */
export class PushReads extends Context.Service<
  PushReads,
  { readonly subscribe: () => Stream.Stream<ReadPosition> }
>()("polaris/daemon/push/PushReads") {
  static readonly continuity = Layer.effect(
    PushReads,
    Effect.gen(function* () {
      const continuity = yield* Continuity;

      return PushReads.of({
        subscribe: () =>
          continuity.watch.pipe(
            Stream.flatMap(
              ContinuityItem.match({
                Snapshot: ({ reads }) => Stream.fromIterable(reads),
                Read: ({ position }) => Stream.make(position),
                Draft: () => Stream.empty,
              })
            )
          ),
      });
    })
  );
}

export const PushNotifier = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* PushHostEvents;
    const reads = yield* PushReads;
    const route = yield* RelayRoute;
    const presence = yield* HostPresence;
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);
    let plan: PlanState = emptyPlan;
    let following: Fiber.Fiber<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let held: Held = [];
    let followingReads: Fiber.Fiber<void> | null = null;

    const contextNow = () => ({ ...route.host, now: Date.now() });

    const wake = (pushes: ReadonlyArray<Push>) => {
      for (const { message, automatic } of pushes)
        for (const target of route.pushTargets())
          // The device's own setting for automatic notifications (ENG-462).
          if (!automatic || target.registration.automatic !== false)
            runFork(
              route
                .wake(target, message)
                .pipe(
                  Effect.flatMap((outcome) => Effect.logInfo(`push: ${message.kind} ${outcome}`))
                )
            );
    };

    const setHeld = (next: Held) => {
      held = next;

      if (held.length === 0 && followingReads !== null) {
        runFork(Fiber.interrupt(followingReads));
        followingReads = null;
      } else if (held.length > 0 && followingReads === null)
        followingReads = runFork(
          Stream.runForEach(reads.subscribe(), (read) =>
            Effect.sync(() => setHeld(settleRead(held, read)))
          )
        );
    };

    // While the user is at a Desktop App the push waits for them to leave (ENG-495).
    const send = (pushes: ReadonlyArray<Push>) => {
      if (presence.present()) setHeld(hold(held, pushes));
      else wake(pushes);
    };

    const release = (present: boolean) => {
      if (present) return;
      const due = held;
      setHeld([]);
      wake(due);
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const next = nextSettle(plan);

      if (next === null) return;
      timer = setTimeout(settle, Math.max(0, next - Date.now()));
    };

    const settle = () => {
      timer = null;
      const planned = planSettled(plan, contextNow());
      plan = planned.state;
      send(planned.send);
      schedule();
    };

    const onItem = (item: HostStreamItem) =>
      Effect.sync(() => {
        setHeld(settleItem(held, item));
        const planned = planItem(plan, item, contextNow());
        plan = planned.state;
        send(planned.send);
        schedule();
      });

    const stop = () => {
      if (following !== null) runFork(Fiber.interrupt(following));
      following = null;
      plan = emptyPlan;
      setHeld([]);
      schedule();
    };

    const reconcile = () => {
      const wanted = route.pushTargets().length > 0;

      if (wanted && following === null)
        following = runFork(Stream.runForEach(events.subscribe(), onItem));
      else if (!wanted && following !== null) stop();
    };

    const unwatch = route.watchPush(reconcile);
    const unwatchPresence = presence.watch(release);
    reconcile();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unwatch();
        unwatchPresence();
        stop();
      })
    );
  })
);

/** The notifier on the Engine's Host stream and Continuity's read positions, as the Daemon runs it. */
export const PushNotifierLive = PushNotifier.pipe(
  Layer.provide(Layer.merge(PushHostEvents.engine, PushReads.continuity))
);
