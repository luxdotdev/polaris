/**
 * One window's open subscriptions: each runs its feed on the Client runtime and
 * pushes items into the window's batcher. Closing the window interrupts them all.
 */
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect";
import { CHANNELS, type BatchEntry, type IpcError } from "../../shared/api.ts";
import type { ClientRuntime } from "../hosts.ts";
import { newBatcher } from "./batcher.ts";
import type { SubscribeEnvelope } from "../../shared/contract.ts";
import { feedOpener, isSubscriptionKind } from "./feeds.ts";

export interface WindowTarget {
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, entries: ReadonlyArray<BatchEntry>) => void;
}

export interface WindowSubscriptions {
  readonly subscribe: (envelope: SubscribeEnvelope) => void;
  readonly unsubscribe: (id: number) => void;
  readonly dispose: () => void;
}

export interface WindowSubscriptionsInput {
  readonly runtime: ClientRuntime;
  readonly target: WindowTarget;
}

const endError = (exit: Exit.Exit<void, IpcError>): IpcError | null =>
  Exit.match(exit, {
    onSuccess: () => null,
    onFailure: (cause) =>
      Option.getOrElse(Cause.findErrorOption(cause), () => ({
        code: "Defect",
        message: Cause.pretty(cause),
      })),
  });

export const windowSubscriptions = ({
  runtime,
  target,
}: WindowSubscriptionsInput): WindowSubscriptions => {
  const fibers = new Map<number, Fiber.Fiber<void, IpcError>>();

  const batcher = newBatcher({
    send: (entries) => {
      if (!target.isDestroyed()) target.send(CHANNELS.batch, entries);
    },
  });

  const subscribe = ({ id, kind, input }: SubscribeEnvelope) => {
    if (fibers.has(id)) return;

    if (!isSubscriptionKind(kind)) {
      batcher.end(id, { code: "UnknownSubscription", message: `no subscription "${kind}"` });

      return;
    }

    const fiber = runtime.runFork(
      feedOpener(kind)(input).pipe(
        Stream.runForEach((item) => Effect.sync(() => batcher.push(id, item)))
      )
    );

    fibers.set(id, fiber);
    fiber.addObserver((exit) => {
      fibers.delete(id);

      if (!Exit.hasInterrupts(exit)) batcher.end(id, endError(exit));
    });
  };

  return {
    subscribe,
    unsubscribe: (id) => {
      const fiber = fibers.get(id);

      if (fiber === undefined) return;
      fibers.delete(id);
      runtime.runFork(Fiber.interrupt(fiber));
    },
    dispose: () => {
      batcher.dispose();
      runtime.runFork(Fiber.interruptAll([...fibers.values()]));
      fibers.clear();
    },
  };
};
