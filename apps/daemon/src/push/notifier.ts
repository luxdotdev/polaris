/**
 * Pushes Needs You, notifications and finished Turns to Linked Devices registered for push
 * (apps/relay README: Push). It follows the Engine's Host stream only while some device is
 * registered, so a Host without one pays nothing; a timer runs only while a Turn settles.
 */
import type { Capability, HostStreamItem } from "@polaris/protocol";
import { Context, Effect, Fiber, Layer, Stream } from "effect";
import { Engine } from "../engine/Engine.ts";
import { RelayRoute } from "../linkedDevices/route.ts";
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

export const PushNotifier = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* PushHostEvents;
    const route = yield* RelayRoute;
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);
    let plan: PlanState = emptyPlan;
    let following: Fiber.Fiber<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const contextNow = () => ({ ...route.host, now: Date.now() });

    const send = (pushes: ReadonlyArray<Push>) => {
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
        const planned = planItem(plan, item, contextNow());
        plan = planned.state;
        send(planned.send);
        schedule();
      });

    const stop = () => {
      if (following !== null) runFork(Fiber.interrupt(following));
      following = null;
      plan = emptyPlan;
      schedule();
    };

    const reconcile = () => {
      const wanted = route.pushTargets().length > 0;

      if (wanted && following === null)
        following = runFork(Stream.runForEach(events.subscribe(), onItem));
      else if (!wanted && following !== null) stop();
    };

    const unwatch = route.watchPush(reconcile);
    reconcile();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unwatch();
        stop();
      })
    );
  })
);

/** The notifier on the Engine's Host stream, as the Daemon runs it. */
export const PushNotifierLive = PushNotifier.pipe(Layer.provide(PushHostEvents.engine));
