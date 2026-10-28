/**
 * The data the unfolded Duo's second half reads for one agent session (D6): the thread's fold
 * and cached findings (the thread the first half leases), and, for the
 * focused Turn, its diff and the Risk Summary already on the Host. It never starts a review.
 */
import {
  GitDiffSpec,
  RiskSummaryRef,
  type RiskFinding,
  SessionId,
  type Turn,
  TurnId,
} from "@polaris/protocol";
import { Effect, Result } from "effect";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DiffFileInput } from "../review/diffRows.ts";
import { parsePatch } from "../review/patch.ts";
import type { HostConnection, LiveHost } from "../runtime/hostConnection.ts";
import { useLiveHost } from "../runtime/hosts.tsx";
import { openThread, type ThreadController } from "../thread/controller.ts";
import type { SessionFold } from "../thread/fold.ts";
import { hostThreadSource } from "../thread/hostSource.ts";
import { threadKey, threads } from "../thread/threads.ts";
import type { TurnFiles } from "./contextRows.ts";

/** The session's thread from the app's registry: the same one the first half's thread leases. */
const useController = (connection: HostConnection | null, sessionId: string) => {
  const live = useLiveHost(connection);
  const [controller, setController] = useState<ThreadController | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const opened = connection !== null && (live !== null || controller !== null);

  useEffect(() => {
    const first = liveRef.current;

    if (!opened || connection === null) return;
    const id = SessionId.make(sessionId);

    const lease = threads.acquire(
      threadKey(connection.hostId, id),
      first === null ? null : () => openThread(hostThreadSource(connection, first), id)
    );

    if (lease === null) return;
    setController(lease.controller);

    return () => {
      lease.release();
      setController(null);
    };
  }, [opened, connection, sessionId]);

  return { live, controller };
};

const noSubscribe = () => () => {};

export interface SessionContextData {
  readonly live: LiveHost | null;
  readonly fold: SessionFold | null;
  readonly findings: ReadonlyArray<RiskFinding>;
  readonly workspacePath: string | null;
}

export const useSessionContext = (
  connection: HostConnection | null,
  sessionId: string
): SessionContextData => {
  const { live, controller } = useController(connection, sessionId);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    () => controller?.get() ?? null
  );

  const fold = state?.fold ?? null;
  const workspaceId = fold?.session.workspaceId ?? null;
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);

  useEffect(() => {
    if (controller === null || workspaceId === null) return;
    let gone = false;
    void controller.workspace(workspaceId).then((found) => {
      if (!gone) setWorkspacePath(found?.path ?? null);
    });

    return () => {
      gone = true;
    };
  }, [controller, workspaceId]);

  return { live, fold, findings: state?.findings ?? [], workspacePath };
};

const decoder = new TextDecoder();

const loadFiles = (live: LiveHost, cwd: string, turn: Turn) =>
  Effect.gen(function* () {
    const diff = yield* live.client["git.diff"]({
      cwd,
      spec: GitDiffSpec.cases.Turn.make({
        sessionId: turn.sessionId,
        turnId: TurnId.make(turn.id),
      }),
    });

    const bytes = yield* live.blobs.take(diff.blobId);
    const index = new Map((diff.fileIndex ?? []).map((f) => [f.path, f]));

    return parsePatch(decoder.decode(bytes)).map((file): DiffFileInput => ({
      diff: file,
      added: index.get(file.name)?.additions ?? file.hunks.reduce((n, h) => n + h.additionLines, 0),
      removed:
        index.get(file.name)?.deletions ?? file.hunks.reduce((n, h) => n + h.deletionLines, 0),
    }));
  });

const cachedSummary = (live: LiveHost, repo: string, head: string) =>
  live.client["review.riskSummary"]({ ref: RiskSummaryRef.cases.LatestAt.make({ repo, head }) });

/** The focused Turn's diff and cached summary, read again when its after-checkpoint moves. */
export const useTurnFiles = (
  live: LiveHost | null,
  cwd: string | null,
  repo: string | null,
  turn: Turn | null
): TurnFiles => {
  const [files, setFiles] = useState<TurnFiles>({ kind: "loading" });
  const ended = turn !== null && turn.status !== "working";
  const key = turn === null ? null : `${turn.id}:${turn.checkpointAfter ?? ""}`;

  useEffect(() => {
    if (turn !== null && !ended) {
      setFiles({ kind: "working" });

      return;
    }

    if (live === null || cwd === null || turn === null) return;
    let current = true;
    setFiles({ kind: "loading" });
    const head = turn.checkpointAfter;

    const summary =
      repo === null || head === null
        ? Effect.succeed(null)
        : Effect.orElseSucceed(cachedSummary(live, repo, head), () => null);

    // A failed diff keeps the summary: its findings still show, under the failure.
    const read = Effect.all([Effect.result(loadFiles(live, cwd, turn)), summary]).pipe(
      Effect.map(([loaded, found]): TurnFiles =>
        Result.match(loaded, {
          onSuccess: (files) => ({ kind: "ready", files, summary: found }),
          onFailure: (error) => ({ kind: "failed", message: error.message, summary: found }),
        })
      )
    );

    void Effect.runPromise(read).then((next) => {
      if (current) setFiles(next);
    });

    return () => {
      current = false;
    };
    // Keyed by the Turn's after-checkpoint, not by every session re-read.
  }, [live, cwd, repo, key, ended]);

  return files;
};
