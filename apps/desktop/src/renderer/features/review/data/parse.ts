/**
 * Patch parsing for Review: on the main thread for small patches, in a worker past
 * `WORKER_PARSE_BYTES`, in batches so the first files can render while the rest parse.
 */
import type { FileDiffMetadata } from "@pierre/diffs";
import type { PatchFile } from "../model/patch.ts";
import { WORKER_PARSE_BYTES } from "../model/policy.ts";
import { parseFiles } from "./parseFiles.ts";
import ParseWorker from "./parse.worker.ts?worker";

/** Files per worker message: the first batch paints while the next parses. */
export const PARSE_BATCH = 400;

let worker: Worker | null = null;

let nextId = 0;

const waiting = new Map<number, (files: Array<FileDiffMetadata>) => void>();

const failing = new Map<number, (cause: Error) => void>();

const parser = () => {
  if (worker !== null) return worker;

  const created = new ParseWorker();

  // A worker that fails fails every batch waiting on it, rather than leaving them pending.
  created.addEventListener("error", (event) => {
    for (const fail of failing.values())
      fail(new Error(`the patch parser failed: ${event.message}`));

    waiting.clear();
    failing.clear();
    worker = null;
  });
  created.addEventListener(
    "message",
    (event: MessageEvent<{ id: number; files: Array<FileDiffMetadata> }>) => {
      waiting.get(event.data.id)?.(event.data.files);
      waiting.delete(event.data.id);
      failing.delete(event.data.id);
    }
  );
  worker = created;

  return created;
};

const inWorker = (
  bytes: Uint8Array,
  files: ReadonlyArray<PatchFile>,
  keys: ReadonlyArray<string>
) =>
  new Promise<Array<FileDiffMetadata>>((resolve, reject) => {
    const id = nextId++;

    waiting.set(id, resolve);
    failing.set(id, reject);
    parser().postMessage({ id, bytes, files, keys });
  });

/**
 * Parses `files` of `bytes`, calling `onBatch` with each batch in order; resolves when all
 * are parsed. `live()` false stops early (the Review closed or its diff changed).
 */
export const parseInBatches = async (
  bytes: Uint8Array,
  files: ReadonlyArray<PatchFile>,
  keys: ReadonlyArray<string>,
  onBatch: (start: number, parsed: ReadonlyArray<FileDiffMetadata>) => void,
  live: () => boolean
) => {
  if (bytes.byteLength < WORKER_PARSE_BYTES) {
    onBatch(0, parseFiles({ bytes, files, keys }));

    return;
  }

  for (let start = 0; start < files.length && live(); start += PARSE_BATCH) {
    const batch = files.slice(start, start + PARSE_BATCH);
    const first = batch[0];
    const last = batch.at(-1);

    if (first === undefined || last === undefined) break;
    // Only this batch's bytes cross to the worker; offsets are rebased onto the slice.
    const slice = bytes.slice(first.offset, last.offset + last.length);
    const rebased = batch.map((f) => ({ ...f, offset: f.offset - first.offset }));
    const parsed = await inWorker(slice, rebased, keys.slice(start, start + PARSE_BATCH));

    if (live()) onBatch(start, parsed);
  }
};
