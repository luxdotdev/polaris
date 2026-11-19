/**
 * The file a Write is about to overwrite, read for its patch (ENG-979): only a regular text
 * file inside the session's directory, opened once and read from that descriptor.
 */
import { Schema } from "effect";
import { constants } from "node:fs";
import { type FileHandle, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A file's text before a Write: null when there was no file, undefined when unknown. */
export type Previous = string | null | undefined;

/** Reads a file's current text for a Write's patch, off the event loop; never rejects. */
export type ReadPrevious = (path: string) => Promise<Previous>;

/** Seams between the containment check and the read, so tests can swap the file there. */
export interface ReadHooks {
  readonly beforeOpen?: () => Promise<void>;
  readonly afterOpen?: () => Promise<void>;
}

/** Larger files aren't read: a Write over one shows its patch once Claude Code reports it. */
const PREVIOUS_LIMIT = 1024 * 1024;

/** Never follows a symlink at the file itself, and never blocks opening a FIFO. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Whether `path` (already real) is `root` or inside it. */
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);

  return rel.split(sep)[0] !== ".." && !isAbsolute(rel);
};

/** A filesystem error saying there is no such file. */
const missing = Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }));

interface RealDir {
  readonly real: string;
  readonly exists: boolean;
}

/** The real path of `dir`, or of its nearest existing ancestor when it doesn't exist. */
const realDir = async (dir: string): Promise<RealDir> => {
  try {
    return { real: await realpath(dir), exists: true };
  } catch (error) {
    const parent = dirname(dir);

    if (!missing(error) || parent === dir) throw error;

    return { real: (await realDir(parent)).real, exists: false };
  }
};

/** The handle's text, reading at most `limit` bytes; undefined past it (a file still growing). */
const readLimited = async (handle: FileHandle, limit: number): Promise<string | undefined> => {
  const buffer = Buffer.alloc(limit + 1);
  let total = 0;

  for (;;) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);

    if (bytesRead === 0) return buffer.toString("utf8", 0, total);
    total += bytesRead;

    if (total > limit) return undefined;
  }
};

/** The opened file's text when it is a regular text file that is, right now, inside `root`. */
const readOpened = async (root: string, file: string, hooks: ReadHooks): Promise<Previous> => {
  let handle: FileHandle;

  try {
    handle = await open(file, OPEN_FLAGS);
  } catch (error) {
    // Gone since the check: absent. A symlink (O_NOFOLLOW) or anything else: unknown.
    return missing(error) ? null : undefined;
  }

  try {
    const opened = await handle.stat();

    if (!opened.isFile() || opened.size > PREVIOUS_LIMIT) return undefined;
    await hooks.afterOpen?.();
    // The descriptor is the file now at a real path inside root (an ancestor swapped out isn't).
    const real = await realpath(file);
    const there = await stat(real);

    if (!inside(root, real) || there.dev !== opened.dev || there.ino !== opened.ino)
      return undefined;
    const text = await readLimited(handle, PREVIOUS_LIMIT);

    return text === undefined || text.includes("\0") ? undefined : text;
  } finally {
    await handle.close();
  }
};

/**
 * `ReadPrevious` on this Host's files: a regular text file up to 1 MB whose real path is
 * inside `cwd`, opened once and read from that descriptor. Anything else is never read.
 */
export const readPreviousFile =
  (cwd: string, hooks: ReadHooks = {}): ReadPrevious =>
  async (path) => {
    try {
      const root = await realpath(cwd);
      const target = resolve(cwd, path);
      const parent = await realDir(dirname(target));

      if (!inside(root, parent.real)) return undefined;

      if (!parent.exists) return null;
      await hooks.beforeOpen?.();

      return await readOpened(root, join(parent.real, basename(target)), hooks);
    } catch {
      return undefined;
    }
  };
