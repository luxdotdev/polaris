/**
 * The Changes tab's syntax colours, highlighted in Pierre's worker pool (the provider is
 * `DiffWorkers` around the list) and kept per file content, so scrolling, folding and a
 * refreshed diff never highlight a file twice. Lines draw plain until their file is done.
 */
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import {
  contentKey,
  type HighlightPool,
  highlightLines,
} from "../editor/diff/data/highlightTokens.ts";
import { type DiffSyntax, type FileSyntax, fileSyntax, highlightable } from "./diffSyntax.ts";
import type { DiffFile } from "./model/diff.ts";

/** Files whose colours are kept: a few Turns' worth, oldest dropped first. */
const KEEP = 400;

const done = new Map<string, FileSyntax | null>();

const pending = new Map<string, Promise<void>>();

type Keyed = ReadonlyArray<readonly [DiffFile, string]>;

const keyOf = (file: DiffFile) =>
  `${file.oldPath ?? ""}>${file.path}:${contentKey(
    file.hunks.map((h) => h.lines.map((l) => l.kind[0] + l.text).join("\n")).join("\n@@\n")
  )}`;

const remember = (key: string, syntax: FileSyntax | null) => {
  done.set(key, syntax);

  if (done.size > KEEP) done.delete(done.keys().next().value ?? key);
};

/** The file's highlight, started once however many lists ask for it. */
const highlight = (pool: HighlightPool, file: DiffFile, key: string) => {
  const running = pending.get(key);

  if (running !== undefined) return running;

  const started = fileSyntax(file, (path, text) => highlightLines(pool, path, text))
    .then((syntax) => remember(key, syntax))
    // A pool torn down mid-highlight leaves the file plain; the next list asks again.
    .catch(() => undefined)
    .finally(() => pending.delete(key));

  pending.set(key, started);

  return started;
};

/** The colours already known for these files, by path. */
const known = (keyed: Keyed): DiffSyntax => {
  const map = new Map<string, FileSyntax>();

  for (const [file, key] of keyed) {
    const syntax = done.get(key);

    if (syntax !== undefined && syntax !== null) map.set(file.path, syntax);
  }

  return map;
};

export const useDiffSyntax = (files: ReadonlyArray<DiffFile>): DiffSyntax => {
  const pool = useWorkerPool();

  const keyed: Keyed = useMemo(
    () => files.flatMap((file) => (highlightable(file) ? [[file, keyOf(file)] as const] : [])),
    [files]
  );

  const cached = useMemo(() => known(keyed), [keyed]);
  const [shown, setShown] = useState<{ keyed: Keyed; syntax: DiffSyntax } | null>(null);

  useEffect(() => {
    if (pool === undefined) return undefined;
    let live = true;
    let frame = 0;

    // Files finishing together repaint once, on the next frame.
    const repaint = () => {
      if (live && frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setShown({ keyed, syntax: known(keyed) });
        });
    };

    // A pool with no workers (a test, a failed start) leaves the diff plain and remembers nothing.
    if (!pool.isWorkingPool()) return undefined;

    for (const [file, key] of keyed)
      if (!done.has(key)) void highlight(pool, file, key).then(repaint);

    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [pool, keyed]);

  return shown?.keyed === keyed ? shown.syntax : cached;
};
