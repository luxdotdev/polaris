/**
 * blobs: bulk bytes through the blob channel. A large `files.read` (Daemon →
 * Client) and an `attachments.stage` upload (Client → Daemon), with the
 * Daemon's peak memory while each is in flight.
 */
import { join } from "node:path"
import { Effect } from "effect"
import { awaitReady, cleanup, connect, makeTempDir } from "../daemon.ts"
import { registerWorkspace, settle } from "../drive.ts"
import { randomFile } from "../fixtures.ts"
import { memory, type Scenario, throughput } from "../types.ts"

export const blobs: Scenario = {
  name: "blobs",
  description: "files.read download and attachment upload throughput, peak RSS",
  run: (ctx) =>
    Effect.gen(function* () {
      const size = (ctx.quick ? 16 : 100) * 1024 * 1024
      const dir = yield* Effect.acquireRelease(
        Effect.sync(() => makeTempDir("blobs")),
        (d) => Effect.sync(() => cleanup(d)),
      )
      const file = join(dir, "big.bin")
      yield* Effect.promise(() => Promise.resolve(randomFile(file, size)))
      const daemon = yield* ctx.launch()
      yield* awaitReady(daemon)
      const sampler = yield* ctx.sample(daemon, 50)
      const client = yield* connect(daemon, ctx.transport, "blobs")
      const workspaceId = yield* registerWorkspace(client, dir, "blobs")
      yield* settle(1000)
      const base = sampler.sample()

      // Download.
      const readFrom = base.t
      const t0 = performance.now()
      const read = yield* client.connection.client["files.read"]({
        path: file,
        offset: null,
        length: null,
      })
      if (read.content._tag !== "Blob") return yield* Effect.die(new Error("expected a blob"))
      const bytes = yield* client.connection.blobs.take(read.content.blobId)
      const readSeconds = (performance.now() - t0) / 1000
      if (bytes.byteLength !== size) {
        return yield* Effect.die(new Error(`read ${bytes.byteLength} of ${size} bytes`))
      }
      const readReport = sampler.report(readFrom - 1, sampler.sample().t)
      yield* settle(2000)

      // Upload.
      const uploadFrom = sampler.sample().t
      const t1 = performance.now()
      const blobId = yield* client.connection.blobs.offer(bytes)
      const staged = yield* client.connection.client["attachments.stage"]({
        sessionId: null,
        workspaceId,
        name: "big.bin",
        mimeType: "application/octet-stream",
        blobId,
      })
      const uploadSeconds = (performance.now() - t1) / 1000
      if (staged.size !== size) return yield* Effect.die(new Error(`staged ${staged.size} bytes`))
      const uploadReport = sampler.report(uploadFrom - 1, sampler.sample().t)
      yield* settle(2000)
      const after = sampler.sample()
      // After the measurements: the snapshot allocates.
      yield* ctx.peak(daemon, "after-upload")

      const mb = size / 1e6
      // Transfers allocate in proportion to the payload and GC timing moves the
      // peaks a lot: hold them to 35% or a quarter of the payload.
      const tolerance = { relative: 0.35, absolute: size / 1024 / 1024 / 4 }
      const blobMemory = (bytes: number) => memory(bytes, { tolerance })
      const rate = (mbPerS: number) =>
        throughput(mbPerS, "MB/s", { tolerance: { relative: 0.5, absolute: 0 } })
      return {
        metrics: {
          read_mb_per_s: rate(mb / readSeconds),
          read_rss_peak_over_base_mib: blobMemory(readReport.rssBytes.max - base.rssBytes),
          upload_mb_per_s: rate(mb / uploadSeconds),
          upload_rss_peak_over_base_mib: blobMemory(uploadReport.rssBytes.max - base.rssBytes),
          rss_after_mib: blobMemory(after.rssBytes),
          ...(base.footprintBytes !== null &&
          after.footprintBytes !== null &&
          uploadReport.footprintBytes
            ? {
                upload_footprint_peak_over_base_mib: blobMemory(
                  uploadReport.footprintBytes.max - base.footprintBytes,
                ),
                footprint_retained_mib: blobMemory(after.footprintBytes - base.footprintBytes),
              }
            : {}),
          rss_retained_mib: blobMemory(after.rssBytes - base.rssBytes),
        },
        notes: [
          `${size / 1024 / 1024} MiB of incompressible bytes each way over ${ctx.transport}; RSS sampled every 50 ms`,
        ],
      }
    }),
}
