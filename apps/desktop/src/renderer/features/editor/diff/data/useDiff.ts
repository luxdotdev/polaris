/**
 * A diff tab's content, kept live: read again whenever git's view of the Workspace moves
 * (each burst of file or git state changes, and each stage or unstage, refreshes it:
 * explorer/data/fetch.ts), as git now sees the file (`liveTarget`). While the Host is away
 * the last diff stays, and an unchanged reread changes nothing.
 */
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../../../shell/hooks.ts";
import { explorerKey, useExplorerState } from "../../explorer/data/store.ts";
import { pairOf } from "../model/content.ts";
import type { DiffTarget } from "../model/target.ts";
import { type ComposedDiff, composeDiff } from "./compose.ts";
import { loadSides } from "./load.ts";
import { liveTarget } from "./openChanges.ts";
import { syntaxPatch } from "./syntax.ts";

export type DiffState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "binary" }
  | { readonly kind: "too-large"; readonly size: number }
  | { readonly kind: "same" }
  | { readonly kind: "ready"; readonly key: string; readonly composed: ComposedDiff };

const LOADING: DiffState = { kind: "loading" };

/** A syntax-aware diff slower than this (a big file's highlight) shows the line diff first. */
const EARLY_MS = 300;

const ready = (composed: ComposedDiff): DiffState => ({
  kind: "ready",
  key: composed.diff.cacheKey ?? "",
  composed,
});

const load = async (
  target: DiffTarget,
  syntax: boolean,
  pool: ReturnType<typeof useWorkerPool>,
  early: (diff: DiffState) => void
): Promise<DiffState> => {
  const sides = await loadSides(target);
  const pair = pairOf(sides.old, sides.new);

  if (pair.kind !== "text") return pair;

  if (!syntax) return ready(composeDiff(target, pair.old, pair.new, null));

  const timer = setTimeout(() => {
    const byLine = composeDiff(target, pair.old, pair.new, null);

    early(ready({ ...byLine, fallback: "pending" }));
  }, EARLY_MS);

  try {
    const patch = await syntaxPatch(pool, target.path, pair.old, pair.new);

    return ready(composeDiff(target, pair.old, pair.new, patch));
  } finally {
    clearTimeout(timer);
  }
};

/** The same content read again keeps the state it had, so Pierre doesn't redraw. */
const settle = (before: DiffState, after: DiffState) =>
  before.kind === "ready" &&
  after.kind === "ready" &&
  before.key === after.key &&
  before.composed.mode === after.composed.mode &&
  before.composed.fallback === after.composed.fallback
    ? before
    : after;

export const useDiff = (target: DiffTarget, syntax: boolean): DiffState => {
  const pool = useWorkerPool();
  const git = useExplorerState(explorerKey(target.hostKey, target.workspaceId)).git;
  const now = useMemo(() => liveTarget(target, git), [target, git]);

  const connected = useApp(
    (s) => s.hosts.find((h) => h.key === target.hostKey)?.status.state === "connected"
  );

  const [state, setState] = useState<{ readonly file: string; readonly diff: DiffState }>({
    file: "",
    diff: LOADING,
  });

  // Switching syntax-aware on or off keeps the diff shown until the new one is ready.
  const file = JSON.stringify([target.hostKey, target.path, target.side, target.git]);

  useEffect(() => {
    // `now` changes with each new status: the files may have moved.
    if (!connected) return undefined;
    let live = true;

    // Only a tab with nothing to show yet takes the early line diff; a shown diff stays.
    const early = (diff: DiffState) => {
      if (live) setState((s) => (s.file === file && s.diff.kind === "ready" ? s : { file, diff }));
    };

    load(now, syntax, pool, early)
      .then((diff) => {
        if (live) setState((s) => ({ file, diff: s.file === file ? settle(s.diff, diff) : diff }));
      })
      .catch((cause: unknown) => {
        if (live)
          setState({
            file,
            diff: {
              kind: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            },
          });
      });

    return () => {
      live = false;
    };
  }, [now, file, syntax, connected, pool]);

  return state.file === file ? state.diff : LOADING;
};
