/**
 * Parses each file of a patch on its own (Pierre's `processFile`), so a file's metadata
 * always matches its `PatchFile`. Shared by the main thread and the parse worker.
 */
import { type FileDiffMetadata, processFile } from "@pierre/diffs";
import { fileText, type PatchFile } from "../model/patch.ts";

const TYPES = {
  added: "new",
  deleted: "deleted",
  renamed: "rename-pure",
  copied: "rename-pure",
  modified: "change",
  "mode-changed": "change",
} as const;

/** A file git gave no hunks for (binary, mode change, pure rename): a header and nothing under it. */
const emptyFile = (file: PatchFile, cacheKey: string): FileDiffMetadata => {
  const metadata: FileDiffMetadata = {
    name: file.path,
    type: TYPES[file.status],
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    cacheKey,
  };

  if (file.oldPath !== null) metadata.prevName = file.oldPath;

  return metadata;
};

export interface ParseRequest {
  readonly bytes: Uint8Array;
  readonly files: ReadonlyArray<PatchFile>;
  /** Pierre's worker-pool cache key per file (its fingerprint). */
  readonly keys: ReadonlyArray<string>;
}

export const parseFiles = ({ bytes, files, keys }: ParseRequest): Array<FileDiffMetadata> =>
  files.map((file, i) => {
    const cacheKey = keys[i] ?? `${i}`;

    const parsed = file.binary
      ? undefined
      : processFile(fileText(bytes, file), { cacheKey, isGitDiff: true });

    if (parsed === undefined) return emptyFile(file, cacheKey);

    if (file.oldPath !== null) parsed.prevName ??= file.oldPath;

    return parsed;
  });
