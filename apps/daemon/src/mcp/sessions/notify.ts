/**
 * `notify`: an agent's notification for the user, as a `SessionNotified` event; and Polaris's
 * own when a Constellation needs the user (`automatic`, ENG-462), which an agent's repeat joins.
 */
import { CommandId, DomainEvent, SessionNotification, type SessionId } from "@polaris/protocol";
import { Data, Effect } from "effect";
import type { ServiceError } from "../../services.ts";
import type { EventStore } from "../../store/EventStore.ts";

/** At most one notification per session in this long, so an agent can't flood the user. */
export const NOTIFY_INTERVAL_MS = 30_000;

export type NotifyOutcome = Data.TaggedEnum<{
  Sent: Record<never, never>;
  /** A retry of a call that already sent it. */
  AlreadySent: Record<never, never>;
  /** Polaris told the user about this session moments ago (a question, an approval, a Claim). */
  Collapsed: Record<never, never>;
  NotFound: Record<never, never>;
  RateLimited: { readonly retryInSeconds: number };
}>;

export const NotifyOutcome = Data.taggedEnum<NotifyOutcome>();

export interface NotifyInput {
  readonly title: string;
  readonly body: string;
}

export interface AutomaticInput extends NotifyInput {
  /** The session it is shown on, which a tap opens. */
  readonly sessionId: SessionId;
  readonly constellationId: string;
  /** Other sessions it is also about (the asking worker): their own `notify` joins it too. */
  readonly about: ReadonlyArray<SessionId>;
  /** Stable per cause, so a cause notifies once (`attention:…`). */
  readonly id: string;
}

export interface Notifier {
  readonly notify: (
    sessionId: SessionId,
    input: NotifyInput,
    id: CommandId
  ) => Effect.Effect<NotifyOutcome, ServiceError>;
  /** Records an automatic notification once per `input.id`; false when it was already sent. */
  readonly automatic: (input: AutomaticInput) => Effect.Effect<boolean, ServiceError>;
}

const within = (at: number, last: number | undefined) =>
  last !== undefined && at - last < NOTIFY_INTERVAL_MS;

const notifiedEvent = (
  sessionId: SessionId,
  id: string,
  input: NotifyInput,
  at: number,
  automatic: { readonly constellationId: string } | null
) =>
  DomainEvent.cases.SessionNotified.make({
    sessionId,
    notification: new SessionNotification({
      id,
      title: input.title,
      body: input.body,
      at: new Date(at).toISOString(),
      automatic: automatic !== null,
      constellationId: automatic?.constellationId ?? null,
    }),
  });

export const notifier = (store: EventStore["Service"], now: () => number = Date.now): Notifier => {
  const lastSent = new Map<SessionId, number>();
  const lastAutomatic = new Map<SessionId, number>();

  /** Needs You already reached every device for an approval or question opened this recently. */
  const askedRecently = (pending: ReadonlyMap<string, { readonly openedAt: string }>, at: number) =>
    [...pending.values()].some((request) => within(at, Date.parse(request.openedAt)));

  const notify = Effect.fnUntraced(function* (
    sessionId: SessionId,
    input: NotifyInput,
    id: CommandId
  ) {
    if (yield* store.hasCommandReceipt(id)) return NotifyOutcome.AlreadySent();
    const model = yield* store.model;
    const record = model.sessions.get(sessionId);
    const session = record?.session;

    if (record === undefined || session === undefined || session.state === "archived")
      return NotifyOutcome.NotFound();

    const at = now();

    if (within(at, lastAutomatic.get(sessionId)) || askedRecently(record.pending, at))
      return NotifyOutcome.Collapsed();
    const last = lastSent.get(sessionId);

    if (last !== undefined && within(at, last))
      return NotifyOutcome.RateLimited({
        retryInSeconds: Math.ceil((NOTIFY_INTERVAL_MS - (at - last)) / 1000),
      });

    lastSent.set(sessionId, at);
    yield* store.commit({
      commandId: id,
      decide: () => Effect.succeed([notifiedEvent(sessionId, id, input, at, null)]),
    });

    return NotifyOutcome.Sent();
  });

  const automatic = Effect.fnUntraced(function* (input: AutomaticInput) {
    const commandId = CommandId.make(input.id);

    if (yield* store.hasCommandReceipt(commandId)) return false;
    const model = yield* store.model;

    if (!model.sessions.has(input.sessionId)) return false;
    const at = now();

    for (const sessionId of [input.sessionId, ...input.about]) lastAutomatic.set(sessionId, at);
    yield* store.commit({
      commandId,
      decide: () =>
        Effect.succeed([
          notifiedEvent(input.sessionId, input.id, input, at, {
            constellationId: input.constellationId,
          }),
        ]),
    });

    return true;
  });

  return { notify, automatic };
};
