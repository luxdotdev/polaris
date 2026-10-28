/**
 * A message's image on the phone: from its cache on disk when there, else read from the Host
 * by attachment id (`attachments.read`) and kept. Only one read per attachment at a time.
 */
import { ATTACHMENT_READ_MAX_BYTES, type Attachment, type AttachmentId } from "@polaris/protocol";
import { Effect } from "effect";
import type { LiveHost } from "../runtime/hostConnection.ts";

/** Where images are kept, by attachment id; `native.ts` on disk, a map in tests. */
export interface ImageCache {
  readonly uri: (id: AttachmentId) => string | null;
  readonly write: (id: AttachmentId, bytes: Uint8Array) => Promise<string>;
}

export type ImageState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly uri: string }
  /** Not an image, too large, cleaned up, or the Host can't say: its name shows instead. */
  | { readonly kind: "none" };

export const isPreviewable = (attachment: Attachment) =>
  attachment.mimeType.startsWith("image/") && attachment.size <= ATTACHMENT_READ_MAX_BYTES;

const reading = new Map<AttachmentId, Promise<string | null>>();

export type ReadAttachment = (id: AttachmentId) => Promise<Uint8Array>;

/** The live Host's reader; null while it's away or when it's too old to answer. */
export const hostReader = (live: LiveHost | null): ReadAttachment | null =>
  live === null || !live.capabilities.includes("attachments.read")
    ? null
    : (id) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const read = yield* live.client["attachments.read"]({ attachmentId: id });

            return yield* live.blobs.take(read.blobId);
          })
        );

/** The image's file, or null when there is none to show. */
export const loadImage = (
  cache: ImageCache,
  read: ReadAttachment | null,
  attachment: Attachment
): Promise<string | null> => {
  const kept = cache.uri(attachment.id);

  if (kept !== null) return Promise.resolve(kept);

  if (!isPreviewable(attachment) || read === null) return Promise.resolve(null);
  const held = reading.get(attachment.id);

  if (held !== undefined) return held;

  const started = read(attachment.id)
    .then((bytes) => cache.write(attachment.id, bytes))
    .catch(() => null)
    .finally(() => reading.delete(attachment.id));

  reading.set(attachment.id, started);

  return started;
};
