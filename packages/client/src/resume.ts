/**
 * A resumable, cached, multicast view of one Daemon stream (`subscribeHost`
 * or `subscribeSession`).
 *
 * One upstream subscription serves every local subscriber. After a reconnect
 * it resubscribes with `afterSequence` = the last sequence seen, drops any
 * event at or below it (so a replay overlap never duplicates), and on the host
 * stream, where sequences are gapless, reopens if it ever sees a gap.
 *
 * The feed keeps the last Snapshot and the events after it. A new subscriber
 * first gets that cache (the Desktop App paints from it at once), then live
 * items; if the feed was idle, the upstream restarts from the cached sequence
 * and revalidates. A Snapshot may arrive at any point (e.g. after the cache
 * overflowed and the feed asked for a fresh one), and replaces all prior state.
 */
import {
  Effect,
  Fiber,
  Predicate,
  PubSub,
  type Result,
  type Scope,
  Semaphore,
  Stream,
} from "effect"

export type SequenceMark =
  | { readonly kind: "snapshot"; readonly sequence: number }
  | { readonly kind: "event"; readonly sequence: number }
  | { readonly kind: "synchronized"; readonly sequence: number }
  | { readonly kind: "ephemeral" }

/** Where a feed gets connections from: the HostConnection. */
export interface LiveSource<C> {
  /** Waits for a live connection whose epoch is at least `minEpoch`. */
  readonly next: (minEpoch: number) => Effect.Effect<{ readonly epoch: number; readonly client: C }>
}

export interface FeedOptions<C, A, E> {
  readonly source: LiveSource<C>
  readonly open: (client: C, afterSequence: number | null) => Stream.Stream<A, E>
  readonly mark: (item: A) => SequenceMark
  /** Errors that mean "the connection went away": resubscribe after reconnecting. */
  readonly isDisconnect: (error: E) => boolean
  /** Sequences on this stream have no gaps (true for the host stream). */
  readonly gapless: boolean
  /** Cached events after the Snapshot before the feed asks for a fresh Snapshot. */
  readonly maxCachedEvents?: number
  /** Pause before reopening a stream the Daemon ended normally. */
  readonly reopenDelayMs?: number
}

export interface Feed<A, E> {
  /** Cached items first, then live ones, across reconnects. Fails only with non-connection errors. */
  readonly stream: Stream.Stream<A, E>
  readonly lastSequence: () => number | null
  readonly subscribers: () => number
}

type Message<A, E> =
  | { readonly _tag: "item"; readonly item: A }
  | { readonly _tag: "fail"; readonly error: E }

class Reopen {
  readonly _tag = "Reopen"
  constructor(readonly fresh: boolean) {}
}

export const makeFeed = Effect.fnUntraced(function* <C, A, E>(
  options: FeedOptions<C, A, E>,
): Effect.fn.Return<Feed<A, E>, never, Scope.Scope> {
  const scope = yield* Effect.scope
  const pubsub = yield* PubSub.unbounded<Message<A, E>>()
  const lock = Semaphore.makeUnsafe(1)
  const maxCached = options.maxCachedEvents ?? 10_000

  let lastSequence: number | null = null
  let snapshot: A | null = null
  let events: Array<A> = []
  let synchronized: A | null = null
  let failure: { readonly error: E } | null = null
  let refCount = 0
  let upstream: Fiber.Fiber<void> | null = null

  const publish = (message: Message<A, E>) => PubSub.publish(pubsub, message)

  const handle = (item: A): Effect.Effect<void, Reopen> =>
    lock.withPermit(
      Effect.suspend(() => {
        const mark = options.mark(item)
        switch (mark.kind) {
          case "snapshot":
            lastSequence = mark.sequence
            snapshot = item
            events = []
            synchronized = null
            break
          case "event": {
            if (lastSequence !== null && mark.sequence <= lastSequence) return Effect.void
            if (options.gapless && lastSequence !== null && mark.sequence !== lastSequence + 1)
              return Effect.fail(new Reopen(false))
            lastSequence = mark.sequence
            if (snapshot !== null) {
              events.push(item)
              if (events.length > maxCached) {
                snapshot = null
                events = []
                synchronized = null
                return Effect.andThen(
                  publish({ _tag: "item", item }),
                  Effect.fail(new Reopen(true)),
                )
              }
            }
            break
          }
          case "synchronized":
            synchronized = item
            break
          case "ephemeral":
            break
        }
        return Effect.asVoid(publish({ _tag: "item", item }))
      }),
    )

  const run = Effect.gen(function* () {
    let minEpoch = 0
    let fresh = false
    while (true) {
      const live = yield* options.source.next(minEpoch)
      const after: number | null = fresh ? null : lastSequence
      fresh = false
      const result: Result.Result<void, E | Reopen> = yield* options
        .open(live.client, after)
        .pipe(Stream.runForEach(handle), Effect.result)
      if (result._tag === "Success") {
        minEpoch = live.epoch
        yield* Effect.sleep(options.reopenDelayMs ?? 1000)
        continue
      }
      const error: E | Reopen = result.failure
      if (error instanceof Reopen) {
        minEpoch = live.epoch
        fresh = error.fresh
        continue
      }
      if (options.isDisconnect(error)) {
        minEpoch = live.epoch + 1
        continue
      }
      yield* lock.withPermit(
        Effect.suspend(() => {
          failure = { error }
          return publish({ _tag: "fail", error })
        }),
      )
      return
    }
  })

  const retain = Effect.suspend(() => {
    refCount++
    if (upstream === null) {
      if (failure !== null) {
        failure = null
        lastSequence = null
        snapshot = null
        events = []
        synchronized = null
      }
      return Effect.map(Effect.forkIn(run, scope), (fiber) => {
        upstream = fiber
        fiber.addObserver(() => {
          if (upstream === fiber) upstream = null
        })
      })
    }
    return Effect.void
  })

  const release = Effect.suspend(() => {
    refCount--
    if (refCount === 0 && upstream !== null) {
      const fiber = upstream
      upstream = null
      return Fiber.interrupt(fiber)
    }
    return Effect.void
  })

  const stream: Stream.Stream<A, E> = Stream.unwrap(
    Effect.gen(function* () {
      const { subscription, replay, failed } = yield* lock.withPermit(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(pubsub)
          const replay: Array<A> = []
          if (snapshot !== null) replay.push(snapshot, ...events)
          if (synchronized !== null) replay.push(synchronized)
          return { subscription, replay, failed: upstream === null ? null : failure }
        }),
      )
      yield* Effect.acquireRelease(retain, () => release)
      const live = Stream.fromSubscription(subscription).pipe(
        Stream.mapEffect((message) =>
          message._tag === "item" ? Effect.succeed(message.item) : Effect.fail(message.error),
        ),
      )
      if (failed !== null) return Stream.fail(failed.error)
      return Stream.concat(Stream.fromIterable(replay), live)
    }),
  )

  return {
    stream,
    lastSequence: () => lastSequence,
    subscribers: () => refCount,
  }
})

export const isTaggedWith =
  (tag: string) =>
  (error: unknown): boolean =>
    Predicate.isTagged(error, tag)
