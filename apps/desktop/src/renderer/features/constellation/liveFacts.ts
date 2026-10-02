/**
 * Worker facts from the app's store: the worker's session summary (Harness, Model, context,
 * approvals), its Host's Connection State, and what its open feed shows it running.
 */
import { Predicate } from "effect";
import type { HostView } from "../../../shared/api.ts";
import { type AppState, sessionKey } from "../../store/store.ts";
import type { TurnView } from "../../store/sessionModel.ts";
import {
  type Activity,
  type AttemptData,
  type ConstellationData,
  NO_FACTS,
  type ProjectionData,
  type ReceiptResult,
  type WorkerFacts,
} from "./model/index.ts";
import type { Signals } from "./state.ts";

export const hostKeyOf = (hosts: ReadonlyArray<HostView>, hostId: string): string | null =>
  hosts.find((h) => h.status.host?.hostId === hostId)?.key ?? null;

const percent = (used: number, window: number | null) =>
  window === null || window <= 0 ? null : Math.min(100, Math.round((used / window) * 100));

/** What the worker's Turn in flight is running, from its live items. */
const activityOf = (turn: TurnView | undefined): Activity | null => {
  if (turn === undefined || turn.turn.status !== "working") return null;

  for (const live of [...turn.live.values()].toReversed()) {
    const { item } = live;

    if (item === null) continue;

    if (Predicate.isTagged(item, "CommandExecution") && item.status === "running")
      return { kind: "command", text: item.command, since: turn.turn.startedAt };

    if (Predicate.isTagged(item, "ToolCall") && item.status === "running")
      return { kind: "tool", text: item.name, since: turn.turn.startedAt };
  }

  return null;
};

const AWAY = { reconnecting: "reconnecting", offline: "offline" } as const;

const iso = (epochMs: number) => new Date(epochMs).toISOString();

/** The Daemon's observations win field by field; a null one is unknown, so the session's stays. */
const observedOver = (derived: WorkerFacts, observed: ProjectionData["liveness"]): WorkerFacts => {
  if (observed === null) return derived;
  const { current } = observed;

  return {
    ...derived,
    activity:
      current === null
        ? derived.activity
        : { kind: "command", text: current.command, since: iso(current.startedAt) },
    contextPercent: observed.contextPercent ?? derived.contextPercent,
    queued: observed.queuedInput,
    quietSince: observed.lastOutputAt === null ? null : iso(observed.lastOutputAt),
  };
};

export const workerFactsFrom = (
  state: AppState,
  c: ConstellationData,
  attempt: AttemptData,
  signals: Signals,
  observed: ProjectionData["liveness"] = null
): WorkerFacts => {
  const hostKey = hostKeyOf(state.hosts, attempt.hostId);
  const host = state.hosts.find((h) => h.key === hostKey);

  const entry =
    hostKey === null ? undefined : state.hostModels[hostKey]?.sessions.get(attempt.sessionId);

  const open =
    hostKey === null ? undefined : state.sessions[sessionKey(hostKey, attempt.sessionId)];

  const session = entry?.session ?? open?.session ?? null;
  const usage = session?.contextUsage ?? null;
  const lastTurn = open?.turns.at(-1);
  const status = host?.status.state;

  const derived: WorkerFacts = {
    ...NO_FACTS,
    harness: session?.harness ?? null,
    model: session?.model ?? null,
    remoteHost: attempt.hostId === c.hostId ? null : (host?.label ?? attempt.hostId),
    hostAway: status === "reconnecting" || status === "offline" ? AWAY[status] : null,
    activity: activityOf(lastTurn),
    contextPercent: usage === null ? null : percent(usage.usedTokens, usage.windowTokens),
    approvalSince: entry?.pendingApprovals[0]?.openedAt ?? null,
    // Nudged once (AttemptNudged), then the session ended its Turn again without a Claim.
    stoppedWithoutClaiming:
      attempt.state === "working" &&
      attempt.nudgedAt != null &&
      session?.state === "idle" &&
      session.updatedAt > attempt.nudgedAt,
    subagents: (entry?.subagents ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      agent: s.agent,
      since: s.startedAt,
    })),
  };

  return { ...observedOver(derived, observed), ...signals.workers.get(attempt.id) };
};

/** A verified receipt's command and exit code, when the session that ran it is open. */
export const receiptFrom = (
  state: AppState,
  ref: {
    readonly hostId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly itemId: string;
  },
  signals: Signals
): ReceiptResult | null => {
  const known = signals.receipts.get(ref.itemId);

  if (known !== undefined) return known;
  const hostKey = hostKeyOf(state.hosts, ref.hostId);
  const model = hostKey === null ? undefined : state.sessions[sessionKey(hostKey, ref.sessionId)];
  const turn = model?.turns.find((t) => t.turn.id === ref.turnId);
  const item = turn?.items.find((i) => i.id === ref.itemId);

  return item !== undefined && Predicate.isTagged(item, "CommandExecution")
    ? { command: item.command, exitCode: item.exitCode }
    : null;
};
