import { FileContent, FileError, type FileVersion, Unsupported } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import type { RpcConnection } from "./rpc.ts";

/** Uses the same versioned file API over the local socket and a remote Host's SSH bridge. */
export const readEditorFile = Effect.fn("client.readEditorFile")(function* (
  connection: Pick<RpcConnection, "client" | "blobs">,
  path: string
) {
  const result = yield* connection.client["files.readVersioned"]({ path });

  if (Predicate.isTagged(result.content, "Inline"))
    return { version: result.version, mimeType: result.mimeType, text: result.content.text };
  const bytes = yield* connection.blobs.take(result.content.blobId);

  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: () => new FileError({ path, code: "EENCODING", message: "file is not UTF-8 text" }),
  });

  return { version: result.version, mimeType: result.mimeType, text };
});

/** Large buffers use the binary channel; bytes and line endings are sent exactly as held. */
export const writeEditorFile = Effect.fn("client.writeEditorFile")(function* (
  connection: Pick<RpcConnection, "client" | "blobs">,
  path: string,
  text: string,
  expected: FileVersion
) {
  const bytes = new TextEncoder().encode(text);

  const content =
    bytes.length <= 256 * 1024
      ? FileContent.cases.Inline.make({ text })
      : FileContent.cases.Blob.make({ blobId: yield* connection.blobs.offer(bytes) });

  return yield* connection.client["files.write"]({ path, expected, content });
});

/** Call before exposing editing on a Host negotiated by hello. */
export const requireEditorFiles = (capabilities: ReadonlyArray<string>) =>
  capabilities.includes("files.versioned") && capabilities.includes("files.write")
    ? Effect.void
    : Effect.fail(new Unsupported({ capability: "files.write" }));
