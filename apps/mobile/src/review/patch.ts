/**
 * Pierre Diffs' patch parser, the one part of Pierre the Mobile App runs: Metro resolves
 * `@pierre/diffs` here to Pierre's DOM-free `parsePatchFiles` module alone (metro.config.mjs).
 */
import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";

/** Every file of a unified patch as `git.diff` returns it. */
export const parsePatch = (patch: string): ReadonlyArray<FileDiffMetadata> =>
  parsePatchFiles(patch).flatMap((parsed) => parsed.files);
