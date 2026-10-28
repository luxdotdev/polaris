/**
 * One Turn's Review as React state, over the Host's shared connection: the session and its Turns
 * (`subscribeSession`, re-read after its events), the Turn's diff (`git.diff`, parsed by Pierre's
 * patch parser), and its Risk Summary (`review.runRiskSummary`, then followed live).
 */
import type { DaemonClient } from "@polaris/client/rpc";
import {
  type AgentSession,
  GitDiffSpec,
  ReviewSubject,
  type RiskSummary,
  SessionId,
  SessionStreamItem,
  type Turn,
  TurnId,
} from "@polaris/protocol";
import { Effect, Fiber, Option, Stream } from "effect";
import { useEffect, useMemo, useState } from "react";
import type { HostConnection, LiveHost } from "../runtime/hostConnection.ts";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { DiffFileInput } from "./diffRows.ts";
import { parsePatch } from "./patch.ts";

export interface SessionView {
  readonly session: AgentSession;
  readonly turns: ReadonlyArray<Turn>;
}

export type Loaded<A> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: A }
  | { readonly kind: "failed"; readonly message: string };

const LOADING = { kind: "loading" } as const;

/** Events arrive in bursts (a Turn's items, then its end): one re-read per burst. */
const REFRESH_MS = 150;

/** Enough Turns to number the reviewed one and know what was accepted. */
const TURN_LIMIT = 30;

const readSession = (client: DaemonClient, sessionId: SessionId) =>
  client
    .subscribeSession({ sessionId, afterSequence: null, turnLimit: TURN_LIMIT })
    .pipe(
      Stream.runHead,
      Effect.map(Option.filter(SessionStreamItem.guards.Snapshot)),
      Effect.map(
        Option.map((s): SessionView => ({ session: s.session, turns: s.turns.map((t) => t.turn) }))
      ),
      Effect.map(Option.getOrNull)
    );

const followSession = (
  client: DaemonClient,
  sessionId: SessionId,
  set: (view: Loaded<SessionView>) => void
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void Effect.runPromise(Effect.orElseSucceed(readSession(client, sessionId), () => null)).then(
        (view) => {
          if (view !== null) set({ kind: "ready", value: view });
        }
      );
    }, REFRESH_MS);
  };

  const fiber = Effect.runFork(
    client.subscribeSession({ sessionId, afterSequence: null, turnLimit: TURN_LIMIT }).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          if (SessionStreamItem.guards.Snapshot(item))
            set({
              kind: "ready",
              value: { session: item.session, turns: item.turns.map((t) => t.turn) },
            });
          else if (SessionStreamItem.guards.Event(item)) refresh();
        })
      ),
      Effect.catchTag("NotFound", () =>
        Effect.sync(() => set({ kind: "failed", message: "This agent session isn't on the host" }))
      ),
      // A lost connection ends the stream; the next one resubscribes.
      Effect.ignore
    )
  );

  return () => {
    if (timer !== null) clearTimeout(timer);
    void Effect.runPromise(Fiber.interrupt(fiber));
  };
};

/** The Turn to review: the one asked for, else the latest that ended, else the latest. */
export const reviewedTurn = (turns: ReadonlyArray<Turn>, turnId: string | null): Turn | null => {
  if (turnId !== null) return turns.find((t) => t.id === turnId) ?? null;

  return [...turns].reverse().find((t) => t.status !== "working") ?? turns.at(-1) ?? null;
};

const decoder = new TextDecoder();

const loadDiff = (live: LiveHost, session: AgentSession, turn: Turn) =>
  Effect.gen(function* () {
    const diff = yield* live.client["git.diff"]({
      cwd: session.cwd,
      spec: GitDiffSpec.cases.Turn.make({ sessionId: session.id, turnId: turn.id }),
    });

    const bytes = yield* live.blobs.take(diff.blobId);
    const parsed = parsePatch(decoder.decode(bytes));
    const index = new Map((diff.fileIndex ?? []).map((f) => [f.path, f]));

    return parsed.map((file): DiffFileInput => {
      const entry = index.get(file.name);
      const counted = countLines(file.hunks);

      return {
        diff: file,
        added: entry?.additions ?? counted.added,
        removed: entry?.deletions ?? counted.removed,
      };
    });
  });

const countLines = (hunks: DiffFileInput["diff"]["hunks"]) => ({
  added: hunks.reduce((n, h) => n + h.additionLines, 0),
  removed: hunks.reduce((n, h) => n + h.deletionLines, 0),
});

const followRisk = (
  client: DaemonClient,
  session: AgentSession,
  turnId: TurnId,
  set: (summary: Loaded<RiskSummary>) => void
) => {
  const fiber = Effect.runFork(
    Effect.gen(function* () {
      const first = yield* client["review.runRiskSummary"]({
        workspaceId: session.workspaceId,
        subject: ReviewSubject.cases.SessionTurns.make({
          sessionId: session.id,
          firstTurnId: turnId,
          lastTurnId: turnId,
        }),
        checkoutId: null,
        since: null,
        refresh: false,
        context: null,
      });

      set({ kind: "ready", value: first });
      // Followed even when finished: verdicts and follow-ups still change it.
      yield* client["review.watchRiskSummary"]({ summaryId: first.id }).pipe(
        Stream.runForEach((summary) => Effect.sync(() => set({ kind: "ready", value: summary })))
      );
    }).pipe(
      Effect.catch((error) => Effect.sync(() => set({ kind: "failed", message: error.message })))
    )
  );

  return () => void Effect.runPromise(Fiber.interrupt(fiber));
};

export interface ReviewData {
  readonly live: LiveHost | null;
  readonly session: Loaded<SessionView>;
  readonly turn: Turn | null;
  readonly diff: Loaded<ReadonlyArray<DiffFileInput>>;
  readonly risk: Loaded<RiskSummary>;
}

export const useReview = (
  connection: HostConnection | null,
  sessionId: string,
  turnId: string | null
): ReviewData => {
  const live = useLiveHost(connection);
  const [session, setSession] = useState<Loaded<SessionView>>(LOADING);
  const [diff, setDiff] = useState<Loaded<ReadonlyArray<DiffFileInput>>>(LOADING);
  const [risk, setRisk] = useState<Loaded<RiskSummary>>(LOADING);

  useEffect(() => {
    if (live === null) return;

    return followSession(live.client, SessionId.make(sessionId), setSession);
  }, [live, sessionId]);

  const view = session.kind === "ready" ? session.value : null;

  const turn = useMemo(
    () => (view === null ? null : reviewedTurn(view.turns, turnId)),
    [view, turnId]
  );

  const ended = turn !== null && turn.status !== "working";

  const diffKey = turn === null ? null : `${turn.id}:${turn.checkpointAfter ?? ""}`;

  useEffect(() => {
    if (live === null || view === null || turn === null || !ended) return;

    let current = true;

    setDiff(LOADING);

    const loaded = loadDiff(live, view.session, turn).pipe(
      Effect.match({
        onSuccess: (value): Loaded<ReadonlyArray<DiffFileInput>> => ({ kind: "ready", value }),
        onFailure: (error): Loaded<ReadonlyArray<DiffFileInput>> => ({
          kind: "failed",
          message: error.message,
        }),
      })
    );

    void Effect.runPromise(loaded).then((next) => {
      if (current) setDiff(next);
    });

    return () => {
      current = false;
    };
    // Keyed by the Turn's after-checkpoint, not by every session re-read.
  }, [live, diffKey, ended]);

  const sessionKey = view === null ? null : `${view.session.id}:${view.session.workspaceId}`;

  useEffect(() => {
    if (live === null || view === null || turn === null || !ended) return;

    setRisk(LOADING);

    return followRisk(live.client, view.session, turn.id, setRisk);
  }, [live, sessionKey, diffKey, ended]);

  return { live, session, turn, diff, risk };
};
