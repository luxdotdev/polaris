/**
 * Fetching a Turn's diff (`git.diff` with the Turn spec) and parsing it, with
 * a cache so reopening a session paints its last diff at once. A Turn still
 * in flight diffs against the working tree, so it's fetched again as it goes.
 */
import type { GitDiffSpec, SessionId, TurnId } from "@polaris/protocol";
import { Data } from "effect";
import { useEffect, useState } from "react";
import { type DiffFile, parseUnifiedDiff } from "./model/diff.ts";

export type DiffState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly files: ReadonlyArray<DiffFile> }
  | { readonly kind: "too-large"; readonly bytes: number }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

/** A new Worktree exists a moment after its session starts; until then git finds no repository. */
const RETRIES = 5;

const RETRY_MS = 1000;

const retryable = (state: DiffState) =>
  state.kind === "error" && /not a git repository/i.test(state.message);

/** Past this, parsing on the main thread would drop frames; Review (Pierre) takes over. */
const MAX_BYTES = 4 * 1024 * 1024;

const cache = new Map<string, DiffState>();

const Specs = Data.taggedEnum<GitDiffSpec>();

const load = async (
  hostKey: string,
  cwd: string,
  sessionId: SessionId,
  turnId: TurnId
): Promise<DiffState> => {
  const result = await window.polaris.request("git.diff", {
    hostKey,
    cwd,
    spec: Specs.Turn({ sessionId, turnId }),
  });

  if (!result.ok) return { kind: "error", ...result.error };
  const { bytes } = result.value;

  if (bytes.byteLength > MAX_BYTES) return { kind: "too-large", bytes: bytes.byteLength };

  return { kind: "ready", files: parseUnifiedDiff(new TextDecoder().decode(bytes)) };
};

/** The Turn's diff; `revision` changes when it may have (the Turn's status, its file changes). */
export const useTurnDiff = (
  hostKey: string,
  cwd: string,
  sessionId: SessionId,
  turnId: TurnId | null,
  revision: string
): DiffState => {
  const key = turnId === null ? "" : `${hostKey}\u0000${sessionId}\u0000${turnId}`;
  const [state, setState] = useState<{ key: string; value: DiffState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (turnId === null) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void load(hostKey, cwd, sessionId, turnId).then((value) => {
      if (!live) return;

      if (retryable(value) && attempt < RETRIES) {
        timer = setTimeout(() => setAttempt(attempt + 1), RETRY_MS);

        return;
      }

      cache.set(key, value);
      setState({ key, value });
    });

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hostKey, cwd, sessionId, turnId, key, revision, attempt]);

  if (state?.key === key) return state.value;

  return cache.get(key) ?? { kind: "loading" };
};
