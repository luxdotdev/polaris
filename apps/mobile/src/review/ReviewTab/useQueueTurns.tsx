/**
 * Reads each ready agent session's latest Turn for the queue: its number, the diff's file index,
 * and the Risk Summary the Host already holds for its head, followed live. It never starts a review.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import {
  GitDiffSpec,
  RiskSummaryRef,
  SessionId,
  SessionStreamItem,
  type Turn,
  TurnId,
} from "@polaris/protocol";
import { Effect, Fiber, Option, Stream } from "effect";
import { useCallback, useEffect, useState } from "react";
import type { HomeHost, SessionRow } from "../../home/model/home.ts";
import type { LiveHost } from "../../runtime/hostConnection.ts";
import { useHost, useLiveHost } from "../../runtime/hosts.tsx";
import { reviewedTurn } from "../useReview.ts";
import { type QueueTurn, type TurnRisk, turnKey } from "./queue.ts";

const latestEnded = (client: DaemonClient, sessionId: string) =>
  client
    .subscribeSession({ sessionId: SessionId.make(sessionId), afterSequence: null, turnLimit: 1 })
    .pipe(
      Stream.runHead,
      Effect.map(Option.filter(SessionStreamItem.guards.Snapshot)),
      Effect.map(
        Option.map((s) =>
          reviewedTurn(
            s.turns.map((t) => t.turn),
            null
          )
        )
      ),
      Effect.map(Option.getOrNull),
      Effect.map((turn) => (turn === null || turn.status === "working" ? null : turn))
    );

/** The diff's index only; its bytes are taken so the connection lets go of them. */
const fileStats = (live: LiveHost, cwd: string, turn: Turn) =>
  Effect.gen(function* () {
    const diff = yield* live.client["git.diff"]({
      cwd,
      spec: GitDiffSpec.cases.Turn.make({
        sessionId: turn.sessionId,
        turnId: TurnId.make(turn.id),
      }),
    });

    yield* Effect.ignore(live.blobs.take(diff.blobId));
    const index = diff.fileIndex ?? [];

    return {
      count: diff.files,
      added: index.reduce((n, f) => n + f.additions, 0),
      removed: index.reduce((n, f) => n + f.deletions, 0),
    };
  }).pipe(Effect.orElseSucceed(() => null));

const cachedRisk = (live: LiveHost, repo: string, head: string | null) =>
  head === null || !live.capabilities.includes("review.latest-summary")
    ? Effect.succeed<TurnRisk>({ kind: "unreviewed" })
    : live.client["review.riskSummary"]({
        ref: RiskSummaryRef.cases.LatestAt.make({ repo, head }),
      }).pipe(
        Effect.map((summary): TurnRisk =>
          summary === null ? { kind: "unreviewed" } : { kind: "summary", summary }
        ),
        Effect.catch((error) =>
          Effect.succeed<TurnRisk>({ kind: "failed", message: error.message })
        )
      );

const followTurn = (
  live: LiveHost,
  session: SessionRow["session"],
  repo: string,
  set: (turn: QueueTurn) => void
) =>
  Effect.gen(function* () {
    const turn = yield* latestEnded(live.client, session.id);

    if (turn === null) return;

    const base = {
      turnId: turn.id,
      number: turn.userTurnNumber ?? turn.index + 1,
    };

    const [files, risk] = yield* Effect.all(
      [fileStats(live, session.cwd, turn), cachedRisk(live, repo, turn.checkpointAfter)],
      { concurrency: 2 }
    );

    set({ ...base, files, risk });

    if (risk.kind !== "summary") return;
    // Followed even when finished: verdicts change what is listed.
    yield* live.client["review.watchRiskSummary"]({ summaryId: risk.summary.id }).pipe(
      Stream.runForEach((summary) =>
        Effect.sync(() => set({ ...base, files, risk: { kind: "summary", summary } }))
      )
    );
  }).pipe(Effect.ignore);

/** Loads one row's turn into the queue; renders nothing. */
const TurnLoader = ({
  row,
  repo,
  onTurn,
}: {
  readonly row: SessionRow;
  readonly repo: string;
  readonly onTurn: (key: string, turn: QueueTurn) => void;
}) => {
  const live = useLiveHost(useHost(row.hostId));
  const { session } = row;

  useEffect(() => {
    if (live === null) return;

    const fiber = Effect.runFork(
      followTurn(live, session, repo, (turn) => onTurn(turnKey(row), turn))
    );

    return () => void Effect.runPromise(Fiber.interrupt(fiber));
    // A new Turn moves turnCount; the rest of the session's changes don't need a re-read.
  }, [live, row.key, session.turnCount, repo, onTurn]);

  return null;
};

const repoOf = (hosts: ReadonlyArray<HomeHost>, row: SessionRow): string =>
  hosts
    .find((host) => host.hostId === row.hostId)
    ?.followed.state.workspaces.get(row.session.workspaceId)?.path ?? row.session.cwd;

/** The queue's turns by row key, and the loaders that fill them. */
export const useQueueTurns = (hosts: ReadonlyArray<HomeHost>, rows: ReadonlyArray<SessionRow>) => {
  const [turns, setTurns] = useState<ReadonlyMap<string, QueueTurn>>(() => new Map());

  const onTurn = useCallback(
    (key: string, turn: QueueTurn) => setTurns((all) => new Map(all).set(key, turn)),
    []
  );

  const loaders = rows.map((row) => (
    <TurnLoader key={row.key} row={row} repo={repoOf(hosts, row)} onTurn={onTurn} />
  ));

  return { turns, loaders };
};
