import {
  ChangedOnDisk,
  EditorFileRpcs,
  FileContent,
  FileEntry,
  FileError,
  type ReadVersionedFile,
  type WriteFile,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { BlobChannel } from "../services.ts";
import { detectMimeType } from "./mime.ts";
import { resolveHostPath, toContent, toFsFailure, ReadContent } from "./fs.ts";
import { readVersioned } from "./version.ts";
import { createPath, deletePath, renamePath, writeVersioned } from "./write.ts";
import { watchFile } from "./watch.ts";

const fileError = (input: string) => (cause: unknown) => {
  const failure = toFsFailure(resolveHostPath(input), cause);

  return new FileError({ path: failure.path, code: failure.code, message: failure.message });
};

export const handleReadVersioned = Effect.fn("files.readVersioned")(function* ({
  path,
}: typeof ReadVersionedFile.payloadSchema.Type) {
  const result = yield* Effect.tryPromise({
    try: () => readVersioned(path),
    catch: fileError(path),
  });

  const mimeType = detectMimeType(path, result.bytes.subarray(0, 8192));
  const content = toContent(mimeType, result.bytes);

  if (ReadContent.$is("Inline")(content)) {
    return {
      version: result.version,
      mimeType,
      content: FileContent.cases.Inline.make({ text: content.text }),
    };
  }

  const blobs = yield* BlobChannel;
  const blobId = yield* blobs.offer(result.bytes);

  return { version: result.version, mimeType, content: FileContent.cases.Blob.make({ blobId }) };
});

export const handleWriteFile = Effect.fn("files.write")(function* ({
  path,
  content,
  expected,
}: typeof WriteFile.payloadSchema.Type) {
  let bytes: Uint8Array;

  if (Predicate.isTagged(content, "Inline")) bytes = new TextEncoder().encode(content.text);
  else {
    const blobs = yield* BlobChannel;
    bytes = yield* blobs.take(content.blobId).pipe(Effect.mapError(fileError(path)));
  }

  return yield* Effect.tryPromise({
    try: () => writeVersioned(path, bytes, expected),
    catch: (cause) => (cause instanceof ChangedOnDisk ? cause : fileError(path)(cause)),
  });
});

export const EditorFilesRpcsLive = EditorFileRpcs.toLayer({
  "files.readVersioned": handleReadVersioned,
  "files.write": handleWriteFile,
  "files.create": ({ path, kind }) =>
    Effect.tryPromise({
      try: async () => new FileEntry(await createPath(path, kind)),
      catch: fileError(path),
    }),
  "files.rename": ({ path, destination }) =>
    Effect.tryPromise({
      try: async () => new FileEntry(await renamePath(path, destination)),
      catch: fileError(path),
    }),
  "files.delete": ({ path, permanent }) =>
    Effect.tryPromise({
      try: () => deletePath(path, permanent),
      catch: fileError(path),
    }),
  "files.watchFile": ({ path }) => watchFile(path),
});
