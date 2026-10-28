/**
 * One constellation as React state, over the Host's shared connection: the stream's Snapshot,
 * then a fresh `constellation.status` read after its events (the Host folds the graph, so this
 * app doesn't), and liveness patched in as it arrives. Resubscribes on every new connection.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import {
  type ConstellationStreamItem,
  type HarnessKind,
  ConstellationId,
  SessionId,
  SessionStreamItem,
  TurnItem,
  TaskProjection,
} from "@polaris/protocol";
import { Effect, Fiber, Match, Option, Stream } from "effect";
import { useEffect, useState } from "react";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { ConstellationSource } from "./model.ts";

export interface LeadSession {
  readonly harness: HarnessKind;
  readonly model: string | null;
  readonly state: string;
  /** The lead's latest message to the user, and when it started. */
  readonly lastMessage: { readonly text: string; readonly at: string | null } | null;
}

export type ConstellationFeed =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "live";
      readonly source: ConstellationSource;
      readonly lead: LeadSession | null;
    }
  | { readonly kind: "failed"; readonly message: string };

/** Events arrive in bursts (a claim, then its digest): one re-read per burst. */
const REFRESH_MS = 150;

const withLiveness = (
  source: ConstellationSource,
  attemptId: string,
  patch: Partial<Pick<TaskProjection, "liveness" | "branchFetched">>
): ConstellationSource => ({
  ...source,
  projections: source.projections.map((p) =>
    p.latestAttemptId === attemptId
      ? new TaskProjection({
          taskId: p.taskId,
          state: p.state,
          latestAttemptId: p.latestAttemptId,
          blockedBy: p.blockedBy,
          children: p.children,
          gatePromoted: p.gatePromoted,
          stale: p.stale,
          branchFetched: patch.branchFetched ?? p.branchFetched,
          liveness: patch.liveness === undefined ? p.liveness : patch.liveness,
        })
      : p
  ),
});

const readStatus = (client: DaemonClient, constellationId: ConstellationId) =>
  client["constellation.status"]({ constellationId, json: true }).pipe(
    Effect.map((result) =>
      result.constellation == null
        ? null
        : { constellation: result.constellation, projections: result.projections }
    )
  );

const leadOf = (client: DaemonClient, sessionId: string) =>
  client
    .subscribeSession({ sessionId: SessionId.make(sessionId), afterSequence: null, turnLimit: 3 })
    .pipe(
      Stream.runHead,
      Effect.map(Option.filter(SessionStreamItem.guards.Snapshot)),
      Effect.map(
        Option.map((snapshot): LeadSession => {
          const messages = snapshot.turns.flatMap((t) =>
            t.items.filter(TurnItem.guards.AssistantMessage)
          );

          const last = messages.at(-1);

          return {
            harness: snapshot.session.harness,
            model: snapshot.session.model,
            state: snapshot.session.state,
            lastMessage: last === undefined ? null : { text: last.text, at: last.startedAt },
          };
        })
      ),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed(() => null)
    );

const follow = (
  client: DaemonClient,
  id: ConstellationId,
  set: (update: (feed: ConstellationFeed) => ConstellationFeed) => void
) => {
  let source: ConstellationSource | null = null;
  let lead: LeadSession | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = () => {
    const current = source;

    if (current !== null) set(() => ({ kind: "live", source: current, lead }));
  };

  const refresh = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void Effect.runPromise(Effect.orElseSucceed(readStatus(client, id), () => null)).then(
        (next) => {
          if (next === null) return;
          source = next;
          publish();
          void Effect.runPromise(leadOf(client, next.constellation.leadSessionId)).then((l) => {
            lead = l;
            publish();
          });
        }
      );
    }, REFRESH_MS);
  };

  const onItem = (item: ConstellationStreamItem) =>
    Effect.sync(() =>
      Match.value(item).pipe(
        Match.tag("Snapshot", (s) => {
          source = { constellation: s.constellation, projections: s.projections };
          publish();
          refresh();
        }),
        Match.tag("Event", () => refresh()),
        Match.tag("LivenessChanged", ({ attemptId, liveness }) => {
          if (source === null) return;
          source = withLiveness(source, attemptId, { liveness });
          publish();
        }),
        Match.tag("BranchFetched", ({ attemptId, branchFetched }) => {
          if (source === null) return;
          source = withLiveness(source, attemptId, { branchFetched });
          publish();
        }),
        Match.tag("Synchronized", () => undefined),
        Match.exhaustive
      )
    );

  const fiber = Effect.runFork(
    client["constellation.subscribe"]({ constellationId: id, afterSequence: null }).pipe(
      Stream.runForEach(onItem),
      Effect.catchTag("ConstellationRejected", (error) =>
        Effect.sync(() =>
          set(() => ({
            kind: "failed",
            message: error.findings[0]?.message ?? "This constellation isn't on the host",
          }))
        )
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

export const useConstellation = (
  connection: HostConnection | null,
  constellationId: string
): ConstellationFeed => {
  const live = useLiveHost(connection);
  const [feed, setFeed] = useState<ConstellationFeed>({ kind: "connecting" });

  useEffect(() => {
    if (live === null) return;

    return follow(live.client, ConstellationId.make(constellationId), setFeed);
  }, [live, constellationId]);

  return feed;
};
