/**
 * Handler for `attachments.stage`: the Client has sent the bytes as binary
 * side-chunks under `blobId`; collect them and stage them on the Host.
 */
import { FileError, StageAttachment } from "@polaris/protocol"
import { Effect } from "effect"
import { RpcGroup } from "effect/rpc"
import { paths } from "../paths.ts"
import { AttachmentStore, BlobChannel } from "../services.ts"

export class AttachmentRpcs extends RpcGroup.make(StageAttachment) {}

export const handleStageAttachment = Effect.fn("attachments.stage")(function* ({
  blobId,
  ...rest
}: typeof StageAttachment.payloadSchema.Type) {
  const blobs = yield* BlobChannel
  const store = yield* AttachmentStore
  return yield* blobs.take(blobId).pipe(
    Effect.flatMap((bytes) => store.stage({ ...rest, bytes })),
    Effect.mapError(
      (error) => new FileError({ path: paths().staging, code: "ESTAGE", message: error.message }),
    ),
  )
})

/** Requires `AttachmentStore` (from `AttachmentStoreLive()`), and `BlobChannel` per request. */
export const AttachmentRpcsLive = AttachmentRpcs.toLayer({
  "attachments.stage": handleStageAttachment,
})
