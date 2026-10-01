/**
 * Writes the head version of each changed file into a private temp
 * directory, from git's objects rather than the working tree: a Turn's
 * snapshot is a tree no checkout holds, and a Review Checkout may be dirty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

const HEADER = /^(\S+) (\S+) (\d+)$/;

interface Blob {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Parses `git cat-file --batch` output for the requested paths, in order; missing ones drop out. */
export const parseBatch = (
  output: Uint8Array,
  paths: ReadonlyArray<string>
): ReadonlyArray<Blob> => {
  const decoder = new TextDecoder();
  const blobs: Array<Blob> = [];
  let offset = 0;

  for (const path of paths) {
    const newline = output.indexOf(10, offset);

    if (newline === -1) break;
    const header = HEADER.exec(decoder.decode(output.subarray(offset, newline)));
    offset = newline + 1;

    if (header === null) continue;
    const size = Number(header[3]);

    if (header[2] === "blob") blobs.push({ path, bytes: output.subarray(offset, offset + size) });
    offset += size + 1;
  }

  return blobs;
};

/** A path that stays inside the directory it is joined to. */
const isContained = (path: string) => {
  const clean = normalize(path);

  return !clean.startsWith("..") && !clean.startsWith("/") && !path.includes("\n");
};

/**
 * `git cat-file --batch` with its output in a file: Bun 1.3 keeps a large
 * buffer per chunk read from a pipe, and cat-file writes one small chunk per
 * object (1,000 files cost ~550 MB read from a pipe, ~5 MB from a file).
 */
const catFile = async (cwd: string, input: string, out: string): Promise<Uint8Array> => {
  const proc = Bun.spawn(["git", "cat-file", "--batch"], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    stdin: new Blob([input]),
    stdout: Bun.file(out),
    stderr: "pipe",
  });

  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  if (code !== 0) throw new Error(`git cat-file --batch exited ${code}: ${stderr.trim()}`);

  return Bun.file(out).bytes();
};

export interface Materialized {
  /** Holds the files, at their repository paths; nothing else is in it. */
  readonly dir: string;
  readonly paths: ReadonlyArray<string>;
  /** What `removeMaterialized` deletes. */
  readonly root: string;
}

/**
 * The files of `revision` (a commit or tree) at `paths`, in a new directory
 * only this user can read. The caller removes it with `removeMaterialized`.
 */
export const materialize = async (
  cwd: string,
  revision: string,
  paths: ReadonlyArray<string>
): Promise<Materialized> => {
  const root = mkdtempSync(join(tmpdir(), "polaris-rules-"));
  const dir = join(root, "files");
  mkdirSync(dir, { mode: 0o700 });
  const wanted = paths.filter(isContained);

  if (wanted.length === 0) return { dir, paths: [], root };

  const output = await catFile(
    cwd,
    wanted.map((path) => `${revision}:${path}\n`).join(""),
    join(root, "batch")
  );

  const blobs = parseBatch(output, wanted);

  for (const { path, bytes } of blobs) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
  }

  return { dir, paths: blobs.map((blob) => blob.path), root };
};

export const removeMaterialized = (materialized: Materialized) =>
  rmSync(materialized.root, { recursive: true, force: true });
