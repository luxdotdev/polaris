/**
 * `git.show`: one file's bytes at a revision, for expanding context around a
 * hunk in Review. Reads the object store only, so no hook ever runs.
 */
import { detectMimeType } from "../files/mime.ts";
import { DiffNotFound, NotARepository } from "./diff.ts";
import { findRepoRoot, runGitRaw } from "./git.ts";

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
  const { code, stdout } = await runGitRaw(root, ["cat-file", "blob", object]);

  if (code !== 0) throw new DiffNotFound("file at revision", object);

  return {
    size: stdout.byteLength,
    mimeType: detectMimeType(path, stdout.subarray(0, 8192)),
    bytes: stdout,
  };
};
