import { describe, expect, test } from "bun:test"
import { type Cause, Effect, Fiber, Queue, Stream } from "effect"
import { type ByteTransport, makeWire, type TransportError } from "./wire.ts"

type Pipe = Queue.Queue<Uint8Array, TransportError | Cause.Done>

/** Two in-memory transports wired back to back. `aLog` records what side A wrote. */
const makePair = (writeDelayMs = 0) =>
  Effect.gen(function* () {
    const aToB: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>()
    const bToA: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>()
    const side = (inbox: Pipe, outbox: Pipe, log: Array<Uint8Array>): ByteTransport => ({
      incoming: Stream.fromQueue(inbox),
      write: (bytes) =>
        Effect.sync(() => {
          log.push(bytes)
          Queue.offerUnsafe(outbox, bytes)
        }).pipe(Effect.delay(writeDelayMs)),
      close: Effect.sync(() => {
        Queue.endUnsafe(outbox)
      }),
    })
    const aLog: Array<Uint8Array> = []
    return { a: side(bToA, aToB, aLog), b: side(aToB, bToA, []), aLog }
  })

const bytes = (n: number, seed = 0) => Uint8Array.from({ length: n }, (_, i) => (i + seed) % 251)

const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

describe("wire", () => {
  test("delivers JSON in order and blobs both ways", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { a, b } = yield* makePair()
        const receivedByB: Array<string> = []
        const wa = yield* makeWire(a, () => Effect.void, { blobIdPrefix: "a" })
        const wb = yield* makeWire(b, (t) => Effect.sync(() => receivedByB.push(t)), {
          blobIdPrefix: "b",
        })
        const big = bytes(3 * 1024 * 1024 + 5)
        const id = yield* wa.offerBlob(big)
        for (let i = 0; i < 5; i++) yield* wa.sendJson(`{"n":${i}}`)
        const got = yield* wb.takeBlob(id)
        const back = yield* wb.offerBlob(Stream.fromIterable([bytes(10, 1), bytes(700_000, 2)]))
        const gotBack = yield* wa.takeBlob(back)
        return { got, big, receivedByB, gotBack, stats: wb.stats() }
      }),
    )
    expect(result.got).toEqual(result.big)
    expect(result.receivedByB).toEqual([0, 1, 2, 3, 4].map((n) => `{"n":${n}}`))
    expect(result.gotBack.byteLength).toBe(700_010)
    expect(result.gotBack.subarray(0, 10)).toEqual(bytes(10, 1))
    expect(result.stats.bufferedBlobBytes).toBe(0)
  })

  test("JSON frames are not stuck behind a large blob", async () => {
    const kinds = await run(
      Effect.gen(function* () {
        const { a, b, aLog } = yield* makePair(2)
        const wa = yield* makeWire(a, () => Effect.void)
        yield* makeWire(b, () => Effect.void)
        yield* wa.offerBlob(bytes(4 * 1024 * 1024))
        yield* Effect.yieldNow
        yield* wa.sendJson("{}")
        yield* Effect.sleep(100)
        return aLog.map((f) => f[4])
      }),
    )
    const jsonAt = kinds.indexOf(0)
    expect(kinds.length).toBe(17)
    expect(jsonAt).toBeGreaterThanOrEqual(0)
    expect(jsonAt).toBeLessThan(3)
  })

  test("rejects blobs over the limit and aborted streams", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { a, b } = yield* makePair()
        const wa = yield* makeWire(a, () => Effect.void)
        const wb = yield* makeWire(b, () => Effect.void, { maxBlobBytes: 1024 })
        const tooBig = yield* wa.offerBlob(bytes(4096))
        const failing = yield* wa.offerBlob(
          Stream.concat(Stream.succeed(bytes(10)), Stream.fail("boom")),
        )
        const e1 = yield* Effect.flip(wb.takeBlob(tooBig))
        const e2 = yield* Effect.flip(wb.takeBlob(failing))
        return [e1.reason, e2.reason]
      }),
    )
    expect(result).toEqual(["too-large", "aborted"])
  })

  test("a take times out without progress, and fails when the connection closes", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { a, b } = yield* makePair()
        const wa = yield* makeWire(a, () => Effect.void)
        const wb = yield* makeWire(b, () => Effect.void, { blobIdleTimeoutMs: 100 })
        const timeout = yield* Effect.flip(wb.takeBlob("never"))
        const pending = yield* Effect.forkChild(Effect.flip(wa.takeBlob("later")))
        yield* b.close
        const closed = yield* Fiber.join(pending)
        return [timeout.reason, closed.reason]
      }),
    )
    expect(result).toEqual(["timeout", "closed"])
  })

  test("closed fails on malformed input", async () => {
    const err = await run(
      Effect.gen(function* () {
        const t: ByteTransport = {
          incoming: Stream.succeed(Uint8Array.of(0, 0, 0, 1, 9)),
          write: () => Effect.void,
          close: Effect.void,
        }
        const w = yield* makeWire(t, () => Effect.void)
        return yield* Effect.flip(w.closed)
      }),
    )
    expect(err._tag).toBe("TransportError")
  })
})
