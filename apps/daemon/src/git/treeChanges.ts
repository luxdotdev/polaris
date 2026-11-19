/**
 * What changed between two trees, as an item's file changes (ADR 0117): names from
 * `diff-tree --raw`, and patches built from the blobs with the transcript's own builder.
 */
import { join } from "node:path";
import { filePatch, type ItemFileChange } from "@polaris/protocol";
import { GitOutputTooLarge, gitText, nativePath, runGitRaw } from "./git.ts";

export interface TreeChanges {
  readonly changes: ReadonlyArray<ItemFileChange>;
  /** Changed files past the listed ones. */
  readonly more: number;
}

/** The most files one command's item lists; the rest are counted. */
export const MAX_LISTED_FILES = 200;

/** The most files that get a patch; the rest are names. */
export const MAX_PATCHED_FILES = 20;

/** A blob past this size gets no patch (as a Write's previous file doesn't). */
const MAX_BLOB_BYTES = 1024 * 1024;

/** The blobs read for one command's patches, together. */
const MAX_READ_BYTES = 4 * 1024 * 1024;

const GIT_TIMEOUT_MS = 10_000;

const REGULAR = new Set(["100644", "100755"]);

interface RawEntry {
  readonly path: string;
  readonly kind: ItemFileChange["kind"];
  /** The blobs to diff; null for a submodule, a symlink or a change of mode alone. */
  readonly blobs: { readonly before: string | null; readonly after: string | null } | null;
}

const decoder = new TextDecoder();

const kindOf = (status: string): ItemFileChange["kind"] => {
  if (status.startsWith("A")) return "add";

  return status.startsWith("D") ? "delete" : "modify";
};

const rawEntry = (meta: string, path: string): RawEntry | null => {
  // `:<old mode> <new mode> <old object> <new object> <status>`
  const [oldMode, newMode, before, after, status] = meta.slice(1).split(" ");

  if (!oldMode || !newMode || !before || !after || !status) return null;
  const kind = kindOf(status);

  const files =
    (kind === "add" || REGULAR.has(oldMode)) && (kind === "delete" || REGULAR.has(newMode));

  return {
    path,
    kind,
    blobs:
      files && before !== after
        ? { before: kind === "add" ? null : before, after: kind === "delete" ? null : after }
        : null,
  };
};

/** The entries of `diff-tree --raw -z`: a line of modes, objects and status, then its path. */
const parseRaw = (output: Uint8Array): Array<RawEntry> => {
  const fields = decoder.decode(output).split("\0");
  const entries: Array<RawEntry> = [];

  for (let i = 0; i + 1 < fields.length; i += 2) {
    const entry = rawEntry(fields[i]!, fields[i + 1]!);

    if (entry !== null) entries.push(entry);
  }

  return entries;
};

/** Each object's size, from `cat-file --batch-check`; a missing one has none. */
const blobSizes = async (root: string, objects: ReadonlyArray<string>) => {
  const sizes = new Map<string, number>();

  const listed = await gitText(root, ["cat-file", "--batch-check"], {
    stdin: `${objects.join("\n")}\n`,
    timeoutMs: GIT_TIMEOUT_MS,
  });

  for (const line of listed.split("\n")) {
    const [object, type, size] = line.split(" ");

    if (object && type === "blob" && size) sizes.set(object, Number(size));
  }

  return sizes;
};

/**
 * Each blob's bytes, from one `cat-file --batch`: `<object> blob <size>\n<bytes>\n` per
 * object. Null when they are more than `bytes` together.
 */
const readBlobs = async (root: string, objects: ReadonlyArray<string>, bytes: number) => {
  const blobs = new Map<string, Buffer>();

  if (objects.length === 0) return blobs;

  const result = await runGitRaw(root, ["cat-file", "--batch"], {
    stdin: `${objects.join("\n")}\n`,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: bytes + objects.length * 128,
  }).catch((cause: unknown) => {
    if (cause instanceof GitOutputTooLarge) return null;

    throw cause;
  });

  if (result === null) return null;

  if (result.code !== 0) return blobs;
  const out = Buffer.from(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength);

  for (let at = 0; at < out.length;) {
    const end = out.indexOf(0x0a, at);

    if (end === -1) break;
    const [object, type, size] = out.toString("latin1", at, end).split(" ");

    if (!object || type !== "blob" || !size) break;
    const start = end + 1;
    blobs.set(object, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }

  return blobs;
};

/** git's own test for a binary file: a NUL in its first 8,000 bytes. */
const isBinary = (bytes: Buffer) => bytes.subarray(0, 8000).includes(0);

const text = (blobs: ReadonlyMap<string, Buffer>, object: string | null): string | null => {
  if (object === null) return "";
  const bytes = blobs.get(object);
  const fits = bytes !== undefined && bytes.length <= MAX_BLOB_BYTES;

  return fits && !isBinary(bytes) ? bytes.toString("utf8") : null;
};

const objectsOf = (entry: RawEntry) =>
  [entry.blobs?.before, entry.blobs?.after].flatMap((object) => (object ? [object] : []));

/** The entries whose blobs fit the limits, by their sizes: only when reading them all didn't. */
const fitting = async (root: string, candidates: ReadonlyArray<RawEntry>) => {
  const sizes = await blobSizes(root, candidates.flatMap(objectsOf));
  const chosen: Array<RawEntry> = [];
  let bytes = 0;

  for (const entry of candidates) {
    const size = objectsOf(entry).map((object) => sizes.get(object) ?? Infinity);
    const total = size.reduce((sum, n) => sum + n, 0);

    if (size.some((n) => n > MAX_BLOB_BYTES) || bytes + total > MAX_READ_BYTES) continue;
    bytes += total;
    chosen.push(entry);
  }

  return chosen;
};

/**
 * The blobs of the first entries that can carry a patch. One git when they fit together, as
 * they nearly always do; past that, their sizes pick the ones that do.
 */
const patchBlobs = async (root: string, entries: ReadonlyArray<RawEntry>) => {
  const candidates = entries.filter((entry) => entry.blobs !== null).slice(0, MAX_PATCHED_FILES);

  const read = (from: ReadonlyArray<RawEntry>) =>
    readBlobs(root, [...new Set(from.flatMap(objectsOf))], MAX_READ_BYTES);

  const all = await read(candidates);

  if (all !== null) return { chosen: new Set(candidates), blobs: all };
  const chosen = await fitting(root, candidates);

  return { chosen: new Set(chosen), blobs: (await read(chosen)) ?? new Map<string, Buffer>() };
};

/**
 * The files that differ between trees `before` and `after` of the repository at `root`, by
 * absolute path. With `patches`, the first files small enough to read carry one.
 */
export const treeChanges = async (
  root: string,
  before: string,
  after: string,
  options: { readonly patches: boolean }
): Promise<TreeChanges> => {
  if (before === after) return { changes: [], more: 0 };

  const raw = await runGitRaw(
    root,
    ["diff-tree", "-r", "--raw", "-z", "--no-renames", "--no-abbrev", before, after],
    { timeoutMs: GIT_TIMEOUT_MS }
  );

  if (raw.code !== 0) throw new Error(`git diff-tree failed (${raw.code}): ${raw.stderr.trim()}`);
  const all = parseRaw(raw.stdout);
  const listed = all.slice(0, MAX_LISTED_FILES);
  const picked = options.patches ? await patchBlobs(root, listed) : null;

  const changes = listed.map((entry): ItemFileChange => {
    const change = { path: nativePath(join(root, entry.path)), kind: entry.kind };

    if (picked === null || entry.blobs === null || !picked.chosen.has(entry)) return change;
    const old = text(picked.blobs, entry.blobs.before);
    const now = text(picked.blobs, entry.blobs.after);

    return old === null || now === null ? change : { ...change, patch: filePatch(old, now) };
  });

  return { changes, more: all.length - listed.length };
};
