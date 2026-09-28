/** Test helpers: an in-memory BlobChannel. Not used at runtime. */
import type { BlobId } from "@polaris/protocol"
import { Effect, Layer, Stream } from "effect"
import { BlobChannel, ServiceError } from "../services.ts"

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

export const makeFakeBlobChannel = () => {
  const blobs = new Map<string, Uint8Array>()
  let next = 0
  const service = BlobChannel.of({
    offer: (bytes) =>
      Effect.gen(function* () {
        const data =
          bytes instanceof Uint8Array
            ? bytes
            : concat(yield* Stream.runCollect(bytes).pipe(Effect.orDie))
        const id = `blob-${next++}` as BlobId
        blobs.set(id, data)
        return id
      }),
    take: (blobId) => {
      const data = blobs.get(blobId)
      return data === undefined
        ? Effect.fail(new ServiceError({ service: "BlobChannel", message: `no blob ${blobId}` }))
        : Effect.succeed(data)
    },
  })
  /** Registers bytes as if a Client had sent them. */
  const put = (bytes: Uint8Array): BlobId => {
    const id = `blob-${next++}` as BlobId
    blobs.set(id, bytes)
    return id
  }
  return { blobs, put, layer: Layer.succeed(BlobChannel, service) }
}
