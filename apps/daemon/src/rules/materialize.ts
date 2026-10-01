/**
 * Writes the head version of each changed file into a private temp
 * directory, from git's objects rather than the working tree: a Turn's
 * snapshot is a tree no checkout holds, and a Review Checkout may be dirty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { runGit } from "../git/git.ts";

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
 * The files of `revision` (a commit or tree) at `paths`, in a new directory
 * only this user can read. The caller removes it with `removeMaterialized`.
 */
export const materialize = async (
  cwd: string,
  revision: string,
  paths: ReadonlyArray<string>
): Promise<{ readonly dir: string; readonly paths: ReadonlyArray<string> }> => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-rules-"));
  const wanted = paths.filter(isContained);

  if (wanted.length === 0) return { dir, paths: [] };

  const { stdout } = await runGit(cwd, ["cat-file", "--batch"], {
    stdin: wanted.map((path) => `${revision}:${path}\n`).join(""),
  });

  const blobs = parseBatch(stdout, wanted);

  for (const { path, bytes } of blobs) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
  }

  return { dir, paths: blobs.map((blob) => blob.path) };
};

export const removeMaterialized = (dir: string) => rmSync(dir, { recursive: true, force: true });
