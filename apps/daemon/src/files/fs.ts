/**
 * Read-only file access for `files.listDir`, `files.stat` and `files.read`.
 *
 * Reach: any path the Host user can read. SSH already grants a shell, so there
 * is no Workspace sandbox. M1 has no write RPCs.
 */
import type { Stats } from "node:fs"
import { lstat, open, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { detectMimeType, isTextMime } from "./mime.ts"

/** Reads at or under this size of valid UTF-8 text come back inline; everything else as a blob. */
export const INLINE_TEXT_MAX_BYTES = 256 * 1024
/** Ranges larger than this are streamed from disk into the BlobChannel instead of buffered. */
export const STREAM_MIN_BYTES = 4 * 1024 * 1024
/** Bytes read from the start of a file to detect its mime type. */
const SNIFF_BYTES = 8 * 1024

export class FsFailure extends Error {
  constructor(
    readonly path: string,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const toFsFailure = (path: string, cause: unknown): FsFailure => {
  if (cause instanceof FsFailure) return cause
  const code =
    typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : "EIO"
  return new FsFailure(path, code, cause instanceof Error ? cause.message : String(cause))
}

/** `~` and `~/x` expand to the Host user's home; relative paths resolve against it too. */
export const resolveHostPath = (path: string): string => {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(homedir(), path)
}

export type FileKind = "file" | "directory" | "symlink" | "other"

export interface Entry {
  readonly name: string
  readonly path: string
  readonly kind: FileKind
  readonly size: number
  readonly modifiedAt: string
}

const kindOf = (stats: Stats): FileKind =>
  stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "other"

const toEntry = (path: string, name: string, stats: Stats): Entry => ({
  name,
  path,
  kind: kindOf(stats),
  size: stats.size,
  modifiedAt: stats.mtime.toISOString(),
})

/** `lstat` semantics: a symlink is reported as a symlink, not as its target. */
export const statPath = async (input: string): Promise<Entry> => {
  const path = resolveHostPath(input)
  try {
    const stats = await lstat(path)
    return toEntry(path, path.split("/").pop() || path, stats)
  } catch (cause) {
    throw toFsFailure(path, cause)
  }
}

/** Directories first, then by name. Entries that vanish mid-listing are skipped. */
export const listDir = async (input: string): Promise<Array<Entry>> => {
  const path = resolveHostPath(input)
  let names: Array<string>
  try {
    names = await readdir(path)
  } catch (cause) {
    throw toFsFailure(path, cause)
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const child = join(path, name)
      try {
        return toEntry(child, name, await lstat(child))
      } catch {
        return null
      }
    }),
  )
  return entries
    .filter((entry): entry is Entry => entry !== null)
    .sort((a, b) =>
      a.kind === "directory" && b.kind !== "directory"
        ? -1
        : b.kind === "directory" && a.kind !== "directory"
          ? 1
          : a.name.localeCompare(b.name),
    )
}

export type ReadContent =
  | { readonly _tag: "Inline"; readonly text: string }
  | { readonly _tag: "Bytes"; readonly bytes: Uint8Array }
  /** A large range, to be streamed from disk: bytes `[start, end)` of `path`. */
  | { readonly _tag: "Range"; readonly path: string; readonly start: number; readonly end: number }

export interface ReadResult {
  /** Size of the whole file, not of the range. */
  readonly size: number
  readonly mimeType: string
  readonly content: ReadContent
}

/**
 * Reads `[offset, offset + length)` (clamped to the file). Text within
 * `INLINE_TEXT_MAX_BYTES` that decodes as UTF-8 is inline; anything else,
 * including a range that cuts a UTF-8 character, is returned as bytes for the
 * caller to send through the BlobChannel.
 */
export const readRange = async (
  input: string,
  offset: number | null,
  length: number | null,
): Promise<ReadResult> => {
  const path = resolveHostPath(input)
  try {
    const stats = await stat(path)
    if (stats.isDirectory()) throw new FsFailure(path, "EISDIR", `is a directory: ${path}`)
    if (!stats.isFile()) throw new FsFailure(path, "ENOTFILE", `not a regular file: ${path}`)
    if ((offset !== null && offset < 0) || (length !== null && length < 0)) {
      throw new FsFailure(path, "EINVAL", "offset and length must not be negative")
    }
    const size = stats.size
    const start = Math.min(offset ?? 0, size)
    const end = length === null ? size : Math.min(size, start + length)
    const handle = await open(path, "r")
    try {
      const head = new Uint8Array(Math.min(SNIFF_BYTES, size))
      await handle.read(head, 0, head.length, 0)
      const mimeType = detectMimeType(path, head)
      if (end - start > STREAM_MIN_BYTES) {
        return { size, mimeType, content: { _tag: "Range", path, start, end } }
      }
      const bytes = new Uint8Array(end - start)
      let read = 0
      while (read < bytes.length) {
        const { bytesRead } = await handle.read(bytes, read, bytes.length - read, start + read)
        if (bytesRead === 0) break
        read += bytesRead
      }
      const slice = read === bytes.length ? bytes : bytes.subarray(0, read)
      if (isTextMime(mimeType) && slice.length <= INLINE_TEXT_MAX_BYTES) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(slice)
          return { size, mimeType, content: { _tag: "Inline", text } }
        } catch {
          // The range cut a character (or the file isn't UTF-8): send the bytes.
        }
      }
      return { size, mimeType, content: { _tag: "Bytes", bytes: slice } }
    } finally {
      await handle.close()
    }
  } catch (cause) {
    throw toFsFailure(path, cause)
  }
}
