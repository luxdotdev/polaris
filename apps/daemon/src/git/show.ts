/**
 * `git.show`: one file's bytes at a revision, for expanding context around a
 * hunk in Review. Reads the object store only, so no hook ever runs.
 */
import { detectMimeType } from "../files/mime.ts";
import { DiffNotFound, NotARepository } from "./diff.ts";
import { findRepoRoot, GitOutputTooLarge, runGitRaw } from "./git.ts";
import { megabytes } from "./output.ts";

/** The largest file `git.show` reads; its size is checked before any of its bytes are. */
export const MAX_SHOW_BYTES = 64 * 1024 * 1024;

const SHOW_TIMEOUT_MS = 30_000;

export interface ShownFile {
  readonly size: number;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** `path` is relative to the repository root, as a diff names it. */
export const showFile = async (cwd: string, revision: string, path: string): Promise<ShownFile> => {
  const root = await findRepoRoot(cwd);

  if (root === null) throw new NotARepository(cwd);
  const object = `${revision}:${path.replace(/^\.?\//, "")}`;
  const sized = await runGitRaw(root, ["cat-file", "-s", object], { timeoutMs: SHOW_TIMEOUT_MS });
  const size = Number(new TextDecoder().decode(sized.stdout).trim());

  if (sized.code !== 0) throw new DiffNotFound("file at revision", object);

  const args = ["cat-file", "blob", object];

  if (size > MAX_SHOW_BYTES) {
    throw new GitOutputTooLarge(
      args,
      MAX_SHOW_BYTES,
      `This file is larger than ${megabytes(MAX_SHOW_BYTES)}, too large to show`
    );
  }

  const { code, stdout } = await runGitRaw(root, args, {
    maxOutputBytes: MAX_SHOW_BYTES,
    timeoutMs: SHOW_TIMEOUT_MS,
  });

  if (code !== 0) throw new DiffNotFound("file at revision", object);

  return {
    size: stdout.byteLength,
    mimeType: detectMimeType(path, stdout.subarray(0, 8192)),
    bytes: stdout,
  };
};
