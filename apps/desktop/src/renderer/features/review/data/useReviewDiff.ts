/**
 * Fetches a Review's diff (`git.diff` per section), indexes its files, and parses them in
 * batches (`parse.ts`); the view renders each batch as it lands. Files git gave nothing for
 * are kept: a binary or a mode change still has a header to mark Viewed.
 */
import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useState } from "react";
import type { IpcError } from "../../../../shared/api.ts";
import { polaris } from "../../bridge.ts";
import type { ReviewFile } from "../model/layout.ts";
import { fingerprint, indexPatch } from "../model/patch.ts";
import type { ReviewScale } from "../model/policy.ts";
import { type Fetched, failureOf, loadReviewDiff, type ReviewDiff } from "./load.ts";
import { parseInBatches } from "./parse.ts";
import type { DiffSource, SourceSection } from "./source.ts";

export type { Fetched, ReviewDiff } from "./load.ts";

const fetchSection = async (
  source: DiffSource,
  section: SourceSection,
  start: number
): Promise<Fetched | IpcError> => {
  const result = await polaris().request("git.diff", {
    hostKey: source.hostKey,
    cwd: source.cwd,
    spec: section.spec,
  });

  if (!result.ok) return result.error;

  const { bytes, fileIndex } = result.value;

  const files = indexPatch(bytes, fileIndex ?? []).map((file, i): ReviewFile => ({
    key: `${section.id}:${file.path}`,
    index: start + i,
    section: section.id,
    file,
    fingerprint: fingerprint(bytes, file),
  }));

  return { section, bytes, files };
};

const isError = <A extends object>(value: A | IpcError): value is IpcError => "code" in value;

/** Every section, fetched in order; the first error wins. */
const fetchAll = async (source: DiffSource): Promise<ReadonlyArray<Fetched> | IpcError> => {
  const fetched: Array<Fetched> = [];
  let start = 0;

  for (const section of source.sections) {
    const one = await fetchSection(source, section, start);

    if (isError(one)) return one;

    fetched.push(one);
    start += one.files.length;
  }

  return fetched;
};

export const parseAll = async (
  fetched: ReadonlyArray<Fetched>,
  scale: ReviewScale,
  onParsed: (entries: ReadonlyArray<readonly [string, FileDiffMetadata]>) => void,
  live: () => boolean
) => {
  // List-only: files parse one at a time when opened (`parseOne`).
  if (scale === "list-only") return;

  for (const { bytes, files } of fetched) {
    await parseInBatches(
      bytes,
      files.map((f) => f.file),
      files.map((f) => `${f.fingerprint}:${f.key}`),
      (start, parsed) =>
        onParsed(
          parsed.flatMap((diff, i) => {
            const file = files[start + i];

            return file === undefined ? [] : [[file.key, diff] as const];
          })
        ),
      live
    );
  }
};

/** Parses one file on its own: list-only Reviews open files one at a time. */
export const parseOne = async (bytes: Uint8Array, file: ReviewFile) => {
  let parsed: FileDiffMetadata | undefined;

  await parseInBatches(
    bytes,
    [file.file],
    [`${file.fingerprint}:${file.key}`],
    (_, [diff]) => {
      parsed = diff;
    },
    () => true
  );

  return parsed;
};

export const useReviewDiff = (next: DiffSource | null): ReviewDiff => {
  const [diff, setDiff] = useState<ReviewDiff>({ kind: "idle" });
  // The source changes identity with every store update; only a new key refetches.
  const [source, setSource] = useState(next);

  if ((next?.key ?? null) !== (source?.key ?? null)) setSource(next);

  useEffect(() => {
    if (source === null) {
      setDiff({ kind: "idle" });

      return undefined;
    }

    let live = true;

    setDiff((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    void loadReviewDiff(source, {
      fetch: fetchAll,
      parse: parseAll,
      live: () => live,
      set: setDiff,
    }).catch((cause: unknown) => {
      // A diff that can't be read or parsed says so; it never leaves the pane blank.
      console.warn("polaris: the review diff failed", cause);

      if (live) setDiff(failureOf(cause));
    });

    return () => {
      live = false;
    };
  }, [source]);

  return diff;
};
