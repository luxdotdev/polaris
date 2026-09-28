/**
 * One framed byte connection (a local Unix socket, or SSH stdio through
 * `polaris bridge`) shared by the Daemon's transport and the Client runtime.
 *
 * JSON frames carry RPC messages; blob frames carry binary side-chunks
 * referenced by BlobId. The writer always drains queued JSON frames before the
 * next blob chunk and round-robins between blobs, so a multi-MB file read or
 * diff never holds up a stream by more than one chunk (BLOB_CHUNK_BYTES).
 *
 * Memory limits: an incoming blob larger than `maxBlobBytes`, or one that would
 * push the connection's buffered blob bytes over `maxBufferedBlobBytes`, fails
 * with `too-large` and its bytes are dropped. Blobs nobody claims expire after
 * `unclaimedBlobTtlMs`; a `take` fails with `timeout` if its blob makes no
 * progress for `blobIdleTimeoutMs`. Outgoing stream-sourced blobs buffer at most
 * a few chunks before their source is paused, and `sendJson` waits while more
 * than `maxQueuedJsonBytes` of JSON is queued.
 */
import { Deferred, Effect, Exit, Latch, Schema, type Scope, Stream } from "effect"
import {
  BLOB_CHUNK_BYTES,
  encodeBlob,
  encodeBlobFrame,
  encodeJsonFrame,
  type Frame,
  FrameDecoder,
} from "./frame.ts"
import type { BlobId } from "./ids.ts"

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const BlobFailure = Schema.Literals(["too-large", "timeout", "closed", "aborted"])
export type BlobFailure = typeof BlobFailure.Type

export class BlobError extends Schema.TaggedError<BlobError>()("BlobError", {
  blobId: Schema.String,
  reason: BlobFailure,
  message: Schema.String,
}) {}

/** A bidirectional byte pipe. Implementations adapt sockets and child-process stdio. */
export interface ByteTransport {
  /** Bytes from the peer; ends when the peer closes its side. */
  readonly incoming: Stream.Stream<Uint8Array, TransportError>
  /** Completes once the transport accepted the bytes (waits on backpressure). */
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, TransportError>
  /** Closes the transport. Idempotent. */
  readonly close: Effect.Effect<void>
}

export interface WireOptions {
  /** Prefix for BlobIds this side allocates, so both directions never collide. */
  readonly blobIdPrefix?: string
  readonly maxBlobBytes?: number
  readonly maxBufferedBlobBytes?: number
  readonly blobIdleTimeoutMs?: number
  readonly unclaimedBlobTtlMs?: number
  readonly maxQueuedJsonBytes?: number
}

export const WIRE_DEFAULTS = {
  maxBlobBytes: 512 * 1024 * 1024,
  maxBufferedBlobBytes: 1024 * 1024 * 1024,
  blobIdleTimeoutMs: 60_000,
  unclaimedBlobTtlMs: 5 * 60_000,
  maxQueuedJsonBytes: 8 * 1024 * 1024,
} as const

export type BlobSource<E = never> = Uint8Array | Stream.Stream<Uint8Array, E>

export interface Wire {
  /** Queue one RPC message (already serialized) as a JSON frame. */
  readonly sendJson: (text: string) => Effect.Effect<void, TransportError>
  /** Start sending `source` as a blob; returns its id immediately. */
  readonly offerBlob: <E>(source: BlobSource<E>) => Effect.Effect<BlobId>
  /** Wait for the whole blob the peer sent (or is sending) under `blobId`. Single consumer. */
  readonly takeBlob: (blobId: string) => Effect.Effect<Uint8Array, BlobError>
  /** Succeeds when the peer closed cleanly, fails on a transport or framing error. */
  readonly closed: Effect.Effect<void, TransportError>
  readonly stats: () => {
    readonly bufferedBlobBytes: number
    readonly incomingBlobs: number
    readonly outgoingBlobs: number
    readonly queuedJsonBytes: number
  }
}

/** Frames buffered per outgoing stream-sourced blob before its source is paused. */
const OUT_BLOB_HIGH_WATER = 4

interface OutBlob {
  readonly id: string
  ready(): boolean
  next(): Uint8Array
  done(): boolean
}

interface InBlob {
  parts: Array<Uint8Array>
  size: number
  status: "receiving" | "complete" | "failed"
  claimed: boolean
  touched: number
  readonly deferred: Deferred.Deferred<Uint8Array, BlobError>
}

let blobCounter = 0

const concat = (parts: ReadonlyArray<Uint8Array>, size: number): Uint8Array => {
  if (parts.length === 1) return parts[0]!
  const out = new Uint8Array(size)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

/**
 * Runs a Wire over `transport` for the lifetime of the current scope. Every
 * JSON frame received is handed to `onJson`, in order.
 */
export const makeWire = Effect.fnUntraced(function* (
  transport: ByteTransport,
  onJson: (text: string) => Effect.Effect<void>,
  options: WireOptions = {},
): Effect.fn.Return<Wire, never, Scope.Scope> {
  const prefix = options.blobIdPrefix ?? "b"
  const maxBlobBytes = options.maxBlobBytes ?? WIRE_DEFAULTS.maxBlobBytes
  const maxBuffered = options.maxBufferedBlobBytes ?? WIRE_DEFAULTS.maxBufferedBlobBytes
  const idleTimeout = options.blobIdleTimeoutMs ?? WIRE_DEFAULTS.blobIdleTimeoutMs
  const unclaimedTtl = options.unclaimedBlobTtlMs ?? WIRE_DEFAULTS.unclaimedBlobTtlMs
  const maxQueuedJson = options.maxQueuedJsonBytes ?? WIRE_DEFAULTS.maxQueuedJsonBytes

  const closed = yield* Deferred.make<void, TransportError>()
  let isClosed = false

  // ── Outgoing ──────────────────────────────────────────────────────────────
  const wake = Latch.makeUnsafe(false)
  const jsonSpace = Latch.makeUnsafe(true)
  const jsonQueue: Array<Uint8Array> = []
  let queuedJsonBytes = 0
  const outBlobs: Array<OutBlob> = []
  let roundRobin = 0

  const nextBlobFrame = (): Uint8Array | undefined => {
    for (let i = 0; i < outBlobs.length; i++) {
      const index = (roundRobin + i) % outBlobs.length
      const blob = outBlobs[index]!
      if (!blob.ready()) continue
      const frame = blob.next()
      if (blob.done()) {
        outBlobs.splice(index, 1)
        roundRobin = outBlobs.length === 0 ? 0 : index % outBlobs.length
      } else {
        roundRobin = (index + 1) % outBlobs.length
      }
      return frame
    }
    return undefined
  }

  const writer = Effect.gen(function* () {
    while (true) {
      wake.closeUnsafe()
      const json = jsonQueue.shift()
      if (json !== undefined) {
        queuedJsonBytes -= json.byteLength
        if (queuedJsonBytes <= maxQueuedJson / 2) jsonSpace.openUnsafe()
        yield* transport.write(json)
        continue
      }
      const frame = nextBlobFrame()
      if (frame !== undefined) {
        yield* transport.write(frame)
        continue
      }
      yield* wake.await
    }
  })

  const sendJson = (text: string): Effect.Effect<void, TransportError> =>
    Effect.suspend(() => {
      if (isClosed) return Effect.fail(new TransportError({ message: "connection closed" }))
      const frame = encodeJsonFrame(text)
      jsonQueue.push(frame)
      queuedJsonBytes += frame.byteLength
      wake.openUnsafe()
      if (queuedJsonBytes > maxQueuedJson) {
        jsonSpace.closeUnsafe()
        return jsonSpace.await
      }
      return Effect.void
    })

  const scope = yield* Effect.scope

  const offerBlob = <E>(source: BlobSource<E>): Effect.Effect<BlobId> =>
    Effect.suspend(() => {
      const id = `${prefix}${(++blobCounter).toString(36)}-${crypto.randomUUID().slice(0, 8)}`
      if (source instanceof Uint8Array) {
        const frames = encodeBlob(id, source)
        let pending = frames.next()
        outBlobs.push({
          id,
          ready: () => !pending.done,
          next: () => {
            const frame = pending.value as Uint8Array
            pending = frames.next()
            return frame
          },
          done: () => pending.done === true,
        })
        wake.openUnsafe()
        return Effect.succeed(id as BlobId)
      }
      const buffered: Array<Uint8Array> = []
      const space = Latch.makeUnsafe(true)
      let finished = false
      const push = (frame: Uint8Array) => {
        buffered.push(frame)
        wake.openUnsafe()
      }
      outBlobs.push({
        id,
        ready: () => buffered.length > 0,
        next: () => {
          const frame = buffered.shift()!
          if (buffered.length < OUT_BLOB_HIGH_WATER) space.openUnsafe()
          return frame
        },
        done: () => finished && buffered.length === 0,
      })
      const produce = Stream.runForEach(source, (chunk) =>
        Effect.gen(function* () {
          for (let offset = 0; offset < chunk.byteLength; offset += BLOB_CHUNK_BYTES) {
            push(encodeBlobFrame(id, chunk.subarray(offset, offset + BLOB_CHUNK_BYTES), false))
            space.closeUnsafe()
            if (buffered.length >= OUT_BLOB_HIGH_WATER) yield* space.await
          }
        }),
      ).pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.sync(() => {
            finished = true
            push(encodeBlobFrame(id, new Uint8Array(), true, Exit.isFailure(exit)))
          }),
        ),
      )
      return Effect.as(Effect.forkIn(produce, scope), id as BlobId)
    })

  // ── Incoming ──────────────────────────────────────────────────────────────
  const inBlobs = new Map<string, InBlob>()
  let bufferedBytes = 0

  const inBlob = (blobId: string): InBlob => {
    let blob = inBlobs.get(blobId)
    if (blob === undefined) {
      blob = {
        parts: [],
        size: 0,
        status: "receiving",
        claimed: false,
        touched: Date.now(),
        deferred: Deferred.makeUnsafe<Uint8Array, BlobError>(),
      }
      inBlobs.set(blobId, blob)
    }
    return blob
  }

  const release = (blob: InBlob) => {
    bufferedBytes -= blob.size
    blob.size = 0
    blob.parts = []
  }

  const failBlob = (blobId: string, blob: InBlob, reason: BlobFailure, message: string) => {
    if (blob.status === "receiving") {
      release(blob)
      blob.status = "failed"
      blob.touched = Date.now()
      Deferred.doneUnsafe(blob.deferred, Exit.fail(new BlobError({ blobId, reason, message })))
    }
  }

  const onBlobFrame = (frame: Extract<Frame, { kind: "blob" }>) => {
    const blob = inBlob(frame.blobId)
    if (blob.status !== "receiving") return
    blob.touched = Date.now()
    if (frame.aborted) return failBlob(frame.blobId, blob, "aborted", "the sender aborted the blob")
    const length = frame.bytes.byteLength
    if (length > 0) {
      if (blob.size + length > maxBlobBytes)
        return failBlob(frame.blobId, blob, "too-large", `blob exceeds ${maxBlobBytes} bytes`)
      if (bufferedBytes + length > maxBuffered)
        return failBlob(frame.blobId, blob, "too-large", "connection blob buffer is full")
      blob.parts.push(frame.bytes.slice())
      blob.size += length
      bufferedBytes += length
    }
    if (frame.final) {
      const bytes = concat(blob.parts, blob.size)
      blob.parts = [bytes]
      blob.status = "complete"
      Deferred.doneUnsafe(blob.deferred, Exit.succeed(bytes))
    }
  }

  const takeBlob = (blobId: string): Effect.Effect<Uint8Array, BlobError> =>
    Effect.suspend(() => {
      const blob = inBlob(blobId)
      if (blob.claimed)
        return Effect.fail(
          new BlobError({ blobId, reason: "closed", message: "blob already taken" }),
        )
      if (isClosed && blob.status === "receiving")
        failBlob(blobId, blob, "closed", "connection closed before the blob arrived")
      blob.claimed = true
      blob.touched = Date.now()
      return Deferred.await(blob.deferred).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (inBlobs.get(blobId) === blob) {
              inBlobs.delete(blobId)
              release(blob)
            }
          }),
        ),
      )
    })

  const sweep = Effect.sync(() => {
    const now = Date.now()
    for (const [blobId, blob] of inBlobs) {
      if (blob.status === "receiving" && now - blob.touched > idleTimeout) {
        failBlob(blobId, blob, "timeout", `no progress for ${idleTimeout}ms`)
      } else if (
        !blob.claimed &&
        blob.status !== "receiving" &&
        now - blob.touched > unclaimedTtl
      ) {
        inBlobs.delete(blobId)
        release(blob)
      }
    }
  })

  const decoder = new FrameDecoder()
  const reader = transport.incoming.pipe(
    Stream.runForEach((chunk) =>
      Effect.suspend(() => {
        let frames: Array<Frame>
        try {
          frames = decoder.push(chunk)
        } catch (cause) {
          return Effect.fail(new TransportError({ message: "malformed frame", cause }))
        }
        let i = 0
        return Effect.whileLoop({
          while: () => i < frames.length,
          body: () => {
            const frame = frames[i++]!
            if (frame.kind === "json") return onJson(frame.text)
            onBlobFrame(frame)
            return Effect.void
          },
          step: () => {},
        })
      }),
    ),
  )

  const shutdown = (exit: Exit.Exit<void, TransportError>) =>
    Effect.suspend(() => {
      if (isClosed) return Effect.void
      isClosed = true
      for (const [blobId, blob] of inBlobs) failBlob(blobId, blob, "closed", "connection closed")
      jsonSpace.openUnsafe()
      return Effect.andThen(Deferred.done(closed, exit), transport.close)
    })

  yield* Effect.addFinalizer(() => shutdown(Exit.void))
  yield* reader.pipe(Effect.exit, Effect.flatMap(shutdown), Effect.forkScoped)
  yield* writer.pipe(Effect.exit, Effect.flatMap(shutdown), Effect.forkScoped)
  yield* sweep.pipe(
    Effect.delay(Math.max(50, Math.min(1000, idleTimeout / 4))),
    Effect.forever,
    Effect.forkScoped,
  )

  return {
    sendJson,
    offerBlob,
    takeBlob,
    closed: Deferred.await(closed),
    stats: () => ({
      bufferedBlobBytes: bufferedBytes,
      incomingBlobs: inBlobs.size,
      outgoingBlobs: outBlobs.length,
      queuedJsonBytes,
    }),
  } satisfies Wire
})

/**
 * Exit status of `polaris bridge` when nothing is listening on the Daemon
 * socket (EX_UNAVAILABLE), so a Client can tell "no Daemon" apart from an SSH
 * failure and show the Host as Needs Attention.
 */
export const BRIDGE_EXIT_NO_DAEMON = 69
