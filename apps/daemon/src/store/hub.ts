/**
 * The live fan-out: one bounded buffer per subscriber, so a stalled Client
 * costs at most `capacity` items. Publishing never blocks a commit. On
 * overflow the subscriber is dropped rather than skipping an event, so its
 * stream has no gaps: it ends, and the Client resumes from its last sequence
 * (replayed from the `events` table). Ephemeral items (Deltas, item progress)
 * are only buffered while the buffer is less than half full; a Client that
 * falls behind loses some live output but still gets every item's final state.
 */
import type { EventEnvelope, SessionId, SubagentId, TurnId, TurnItem } from "@polaris/protocol";
import { type Cause, Data, Effect, Predicate, Queue, Stream } from "effect";

/** What subscribers receive: committed events, and ephemeral output deltas and item progress. */
export type LiveItem =
  | {
      readonly _tag: "Event";
      readonly envelope: EventEnvelope;
      readonly sessionId: SessionId | null;
    }
  | {
      readonly _tag: "Delta";
      readonly sessionId: SessionId;
      readonly turnId: TurnId;
      readonly itemId: string;
      readonly field: "text" | "output";
      readonly text: string;
      /** Set for a Subagent's own item. */
      readonly subagentId: SubagentId | null;
    }
  | {
      readonly _tag: "ItemProgress";
      readonly sessionId: SessionId;
      readonly turnId: TurnId;
      readonly item: TurnItem;
      readonly subagentId: SubagentId | null;
    };

/** Constructors and matchers for `LiveItem`. */
export const LiveItem = Data.taggedEnum<LiveItem>();

export type EphemeralItem = Extract<LiveItem, { _tag: "Delta" | "ItemProgress" }>;

export interface SubscribeOptions {
  /** Only this session's items; cheaper than a filter, since other sessions' items skip it. */
  readonly sessionId?: SessionId | undefined;
  readonly filter?: ((item: LiveItem) => boolean) | undefined;
}

interface Subscriber {
  readonly queue: Queue.Queue<LiveItem, Cause.Done>;
  readonly filter: ((item: LiveItem) => boolean) | undefined;
  /** Set for a subscriber to one session only. */
  readonly sessionId: SessionId | undefined;
}

export class LiveHub {
  // Subscribers to one session are kept apart, so an item (most are one session's
  // Deltas) visits only that session's subscribers, not every stream of every Client.
  readonly #everything = new Set<Subscriber>();
  readonly #bySession = new Map<SessionId, Set<Subscriber>>();
  readonly #capacity: number;
  readonly #ephemeralLimit: number;
  #size = 0;

  constructor(capacity: number) {
    this.#capacity = capacity;
    this.#ephemeralLimit = Math.max(1, Math.floor(capacity / 2));
  }

  /** Live subscribers right now. */
  get size(): number {
    return this.#size;
  }

  publish(item: LiveItem): void {
    if (this.#everything.size > 0) this.#offer(this.#everything, item);

    if (item.sessionId !== null) {
      const bucket = this.#bySession.get(item.sessionId);

      if (bucket !== undefined) this.#offer(bucket, item);
    }
  }

  /** A stream of what is published from now on, for as long as the scope lives. */
  subscribe(options?: SubscribeOptions) {
    return Effect.gen({ self: this }, function* () {
      const queue = yield* Queue.dropping<LiveItem, Cause.Done>(this.#capacity);
      const sessionId = options?.sessionId;
      const subscriber: Subscriber = { queue, filter: options?.filter, sessionId };

      if (sessionId === undefined) {
        this.#everything.add(subscriber);
      } else {
        const bucket = this.#bySession.get(sessionId) ?? new Set<Subscriber>();
        bucket.add(subscriber);
        this.#bySession.set(sessionId, bucket);
      }

      this.#size++;
      yield* Effect.addFinalizer(() => Effect.sync(() => this.#drop(subscriber)));

      return Stream.fromQueue(queue);
    });
  }

  #drop(subscriber: Subscriber): void {
    const bucket =
      subscriber.sessionId === undefined
        ? this.#everything
        : this.#bySession.get(subscriber.sessionId);

    if (bucket === undefined || !bucket.delete(subscriber)) return;
    this.#size--;

    if (bucket.size === 0 && subscriber.sessionId !== undefined) {
      this.#bySession.delete(subscriber.sessionId);
    }

    Queue.endUnsafe(subscriber.queue);
  }

  #offer(subscribers: ReadonlySet<Subscriber>, item: LiveItem): void {
    for (const subscriber of subscribers) {
      if (subscriber.filter !== undefined && !subscriber.filter(item)) continue;

      if (!Predicate.isTagged(item, "Event")) {
        if (Queue.sizeUnsafe(subscriber.queue) < this.#ephemeralLimit)
          Queue.offerUnsafe(subscriber.queue, item);
        continue;
      }

      if (!Queue.offerUnsafe(subscriber.queue, item)) this.#drop(subscriber);
    }
  }
}
