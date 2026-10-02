import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { BlobId } from "./ids.ts";

export class FileError extends Schema.TaggedError<FileError>()("FileError", {
  path: Schema.String,
  code: Schema.String,
  message: Schema.String,
}) {}

export const FileKind = Schema.Literals(["file", "directory", "symlink", "other"]);

export class FileEntry extends Schema.Class<FileEntry>("FileEntry")({
  name: Schema.String,
  path: Schema.String,
  kind: FileKind,
  size: Schema.Int,
  modifiedAt: Schema.String,
}) {}

/** What `files.read` returns: inline text, or a BlobId whose bytes follow as binary side-chunks. */
export const FileContent = Schema.TaggedUnion({
  Inline: { text: Schema.String },
  Blob: { blobId: BlobId },
});

export type FileContent = typeof FileContent.Type;

/** Version of the exact bytes returned by readVersioned; hash is lowercase SHA-256. */
export class FileVersion extends Schema.Class<FileVersion>("FileVersion")({
  mtimeMs: Schema.Number,
  size: Schema.Int,
  hash: Schema.String,
}) {}

export class ChangedOnDisk extends Schema.TaggedError<ChangedOnDisk>()("ChangedOnDisk", {
  path: Schema.String,
  /** Null means the file was deleted. */
  current: Schema.NullOr(FileVersion),
}) {}

export const ReadVersionedFile = Rpc.make("files.readVersioned", {
  payload: { path: Schema.String },
  success: Schema.Struct({
    version: FileVersion,
    mimeType: Schema.String,
    content: FileContent,
  }),
  error: FileError,
});

export const WriteFile = Rpc.make("files.write", {
  payload: { path: Schema.String, expected: FileVersion, content: FileContent },
  success: FileVersion,
  error: Schema.Union([FileError, ChangedOnDisk]),
});

export const CreateFile = Rpc.make("files.create", {
  payload: { path: Schema.String, kind: Schema.Literals(["file", "directory"]) },
  success: FileEntry,
  error: FileError,
});

export const RenameFile = Rpc.make("files.rename", {
  payload: { path: Schema.String, destination: Schema.String },
  success: FileEntry,
  error: FileError,
});

/** permanent must be true only after the Client confirms deletion; false never falls back to unlink. */
export const DeleteFile = Rpc.make("files.delete", {
  payload: { path: Schema.String, permanent: Schema.Boolean },
  success: Schema.Struct({ method: Schema.Literals(["trash", "permanent"]) }),
  error: FileError,
});

/** Snapshot first, then invalidations (null on deletion); close the stream when the tab closes. */
export const WatchFile = Rpc.make("files.watchFile", {
  payload: { path: Schema.String },
  success: Schema.Struct({ path: Schema.String, version: Schema.NullOr(FileVersion) }),
  error: FileError,
  stream: true,
});

export class EditorFileRpcs extends RpcGroup.make(
  ReadVersionedFile,
  WriteFile,
  CreateFile,
  RenameFile,
  DeleteFile,
  WatchFile
) {}
