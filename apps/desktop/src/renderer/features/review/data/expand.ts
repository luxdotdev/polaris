/**
 * Context expansion (ENG-218): Pierre asks for a file's full old and new text when the user
 * expands around a hunk; we read them at the diff's two revisions (`git.show`), or from the
 * working tree for a Turn still in flight.
 */
import type { FileDiffContentsLoader, FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs";
import type { FileContentView } from "../../../../shared/api.ts";
import { polaris } from "../../bridge.ts";
import type { ReviewFile } from "../model/layout.ts";
import type { DiffSource } from "./source.ts";

const text = (content: FileContentView) =>
  content.kind === "text" ? content.text : new TextDecoder().decode(content.bytes);

const joinPath = (cwd: string, path: string) => `${cwd.replace(/\/+$/, "")}/${path}`;

const read = async (source: DiffSource, revision: string | null, path: string) => {
  const result =
    revision === null
      ? await polaris().request("files.read", {
          hostKey: source.hostKey,
          path: joinPath(source.cwd, path),
          offset: null,
          length: null,
        })
      : await polaris().request("git.show", {
          hostKey: source.hostKey,
          cwd: source.cwd,
          revision,
          path,
        });

  if (!result.ok) throw new Error(result.error.message);

  return text(result.value.content);
};

/** Pierre's loader for one Review: `fileOf` finds the Review file behind a parsed diff. */
export const contentsLoader =
  (
    source: DiffSource,
    fileOf: (diff: FileDiffMetadata) => ReviewFile | undefined
  ): FileDiffContentsLoader =>
  async (diff): Promise<FileDiffLoadedFiles> => {
    const file = fileOf(diff);
    const section = source.sections.find((s) => s.id === file?.section);

    if (file === undefined || section === undefined)
      throw new Error(`Not in this review: ${diff.name}`);

    const { path, oldPath, status } = file.file;
    const oldName = oldPath ?? path;

    const [before, after] = await Promise.all([
      status === "added" || section.base === null ? "" : read(source, section.base, oldName),
      status === "deleted" ? "" : read(source, section.next, path),
    ]);

    return {
      oldFile: { name: oldName, contents: before },
      newFile: { name: path, contents: after },
    };
  };
