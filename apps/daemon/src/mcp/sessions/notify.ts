/** `notify`: an agent's notification for the user, as a `SessionNotified` event. */
import {
  type CommandId,
  DomainEvent,
  SessionNotification,
  type SessionId,
} from "@polaris/protocol";
import { Data, Effect } from "effect";
import type { EventStore } from "../../store/EventStore.ts";

/** At most one notification per session in this long, so an agent can't flood the user. */
export const NOTIFY_INTERVAL_MS = 30_000;

export type NotifyOutcome = Data.TaggedEnum<{
  Sent: Record<never, never>;
  /** A retry of a call that already sent it. */
  AlreadySent: Record<never, never>;
  NotFound: Record<never, never>;
  RateLimited: { readonly retryInSeconds: number };
}>;

export const NotifyOutcome = Data.taggedEnum<NotifyOutcome>();

export interface NotifyInput {
  readonly title: string;
  readonly body: string;
}

export const notifier = (store: EventStore["Service"], now: () => number = Date.now) => {
  const lastSent = new Map<SessionId, number>();

  return Effect.fnUntraced(function* (sessionId: SessionId, input: NotifyInput, id: CommandId) {
    if (yield* store.hasCommandReceipt(id)) return NotifyOutcome.AlreadySent();
    const model = yield* store.model;
    const session = model.sessions.get(sessionId)?.session;

    if (session === undefined || session.state === "archived") return NotifyOutcome.NotFound();

    const at = now();
    const last = lastSent.get(sessionId);

    if (last !== undefined && at - last < NOTIFY_INTERVAL_MS)
      return NotifyOutcome.RateLimited({
        retryInSeconds: Math.ceil((NOTIFY_INTERVAL_MS - (at - last)) / 1000),
      });

    lastSent.set(sessionId, at);

    yield* store.commit({
      commandId: id,
      decide: () =>
        Effect.succeed([
          DomainEvent.cases.SessionNotified.make({
            sessionId,
            notification: new SessionNotification({
              id,
              title: input.title,
              body: input.body,
              at: new Date(at).toISOString(),
            }),
          }),
        ]),
    });

    return NotifyOutcome.Sent();
  });
};
