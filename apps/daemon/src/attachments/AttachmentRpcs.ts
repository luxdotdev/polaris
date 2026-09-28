/**
 * Handler for `attachments.stage`: the Client sends the bytes as binary
 * side-chunks under `blobId`; they are written to the staging file as they
 * arrive, never collected in memory.
 */
import { FileError, StageAttachment } from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { paths } from "../paths.ts";
import { AttachmentStore, BlobChannel } from "../services.ts";

export class AttachmentRpcs extends RpcGroup.make(StageAttachment) {}

export const handleStageAttachment = Effect.fn("attachments.stage")(function* ({
  blobId,
  ...rest
}: typeof StageAttachment.payloadSchema.Type) {
  const blobs = yield* BlobChannel;
  const store = yield* AttachmentStore;
  return yield* store
    .stage({ ...rest, bytes: blobs.takeStream(blobId) })
    .pipe(
      Effect.mapError(
        (error) => new FileError({ path: paths().staging, code: "ESTAGE", message: error.message })
      )
    );
});

/** Requires `AttachmentStore` (from `AttachmentStoreLive()`), and `BlobChannel` per request. */
export const AttachmentRpcsLive = AttachmentRpcs.toLayer({
  "attachments.stage": handleStageAttachment,
});
