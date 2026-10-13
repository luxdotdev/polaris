/**
 * Reads a diff's two sides from the Host: `git.show` for HEAD and the index (an empty
 * revision is the index), `files.read` for the working tree. A side git doesn't have (a file
 * added since) reads as empty.
 */
import { polaris } from "../../../bridge.ts";
import { EMPTY, MAX_DIFF_BYTES, type SideContent, sideOf } from "../model/content.ts";
import { type DiffSource, type DiffTarget, sourcesOf } from "../model/target.ts";

const MISSING = /NotFound|ENOENT|no such file|not found|does not exist|exists on disk, but not in/i;

const readSide = async (target: DiffTarget, source: DiffSource): Promise<SideContent> => {
  if (source.kind === "none") return EMPTY;

  const result =
    source.kind === "file"
      ? await polaris().request("files.read", {
          hostKey: target.hostKey,
          path: source.path,
          // `size` is the whole file's: a file too large to diff isn't sent past the limit.
          offset: null,
          length: MAX_DIFF_BYTES + 1,
        })
      : await polaris().request("git.show", {
          hostKey: target.hostKey,
          cwd: target.toplevel,
          revision: source.revision,
          path: source.path,
        });

  if (result.ok) return sideOf(result.value.content, result.value.size);

  if (MISSING.test(`${result.error.code} ${result.error.message}`)) return EMPTY;

  throw new Error(result.error.message);
};

export interface LoadedSides {
  readonly old: SideContent;
  readonly new: SideContent;
}

export const loadSides = async (target: DiffTarget): Promise<LoadedSides> => {
  const sources = sourcesOf(target);

  const [old, fresh] = await Promise.all([
    readSide(target, sources.old),
    readSide(target, sources.new),
  ]);

  return { old, new: fresh };
};
