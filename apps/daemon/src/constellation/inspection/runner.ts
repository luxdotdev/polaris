/**
 * The Daemon's side of an Inspection (ADR 0119): it starts the Inspector's session when a Claim
 * is held, releases the Claim when the Inspector is lost, and closes a session whose
 * Inspection is over. Everything is derived from the folds; no Lead Turn is involved.
 */
import {
  AgentSession,
  type Attempt,
  CommandId,
  CommandRejected,
  type Constellation,
  type ConstellationId,
  type Inspection,
  inspecting,
  type LogbookEntry,
  type SessionId,
} from "@polaris/protocol";
import { Context, Duration, Effect, Layer, Predicate, Scope } from "effect";
import { decideSession } from "../../engine/session.ts";
import { inspectorRefusal } from "../../engine/supervisor.inspector.ts";
import { constellationRef } from "../../git/constellationBundles.ts";
import { resolveCommit } from "../../git/git.ts";
import { driverCapabilities } from "../../harness/registry.ts";
import { selectWorker } from "../../harness/constellation/index.ts";
import { pickCelestial } from "../../store/celestial.ts";
import { EventStore } from "../../store/EventStore.ts";
import type { ReadModel, SessionRecord } from "../../store/model.ts";
import { ConstellationHarness } from "../composition/attachments.ts";
import { BUILT_IN } from "../composition/prepare.ts";
import { ConstellationDefaultsPath, getDefaults } from "../defaults.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { commitJournal } from "../delivery/journal.ts";
import { newTurn, startedTurn } from "../delivery/turns.ts";
import { ConstellationOwner } from "../runtime.ts";
import { gitOperation } from "../worktrees.ts";
import { inspectorBrief } from "./brief.ts";
import { claimDiff } from "./diff.ts";
import { fenced } from "./fence.ts";

/** The Task's Logbook as the Inspector is given it; the Daemon reads it, never the Inspector. */
export type InspectorLogbook = (
  constellationId: ConstellationId,
  taskId: Attempt["taskId"]
) => Effect.Effect<ReadonlyArray<LogbookEntry>>;

/** Where the runner reads a Logbook; the composition supplies the service's own read. */
export class InspectorLogbookReader extends Context.Reference<InspectorLogbook>(
  "polaris/daemon/constellation/InspectorLogbook",
  { defaultValue: () => () => Effect.succeed([]) }
) {}

/** Whether a remote worker's claimed head has reached `repo`, where the Inspector reads it. */
export type FetchedHead = (
  repo: string,
  graph: Constellation,
  attempt: Attempt,
  head: string
) => Effect.Effect<boolean>;

/** The bundle's ref in the Lead's repository, as the Client's transfer leaves it. */
export class InspectorFetchedHead extends Context.Reference<FetchedHead>(
  "polaris/daemon/constellation/InspectorFetchedHead",
  {
    defaultValue: () => (repo, graph, attempt, head) =>
      gitOperation(() => resolveCommit(repo, constellationRef(graph.id, attempt.id))).pipe(
        Effect.map((fetched) => fetched === head),
        Effect.catch(() => Effect.succeed(false))
      ),
  }
) {}

/** How long a held Claim waits for its remote head, and how often the runner looks. */
export const REMOTE_HEAD_WAIT = { every: Duration.seconds(2), looks: 150 } as const;

export interface InspectionRunnerService {
  /** Bring one Constellation's Inspectors in line with its folded Inspections. */
  readonly refresh: (id: ConstellationId) => Effect.Effect<void>;
}

/** Delivery calls this on every graph and Turn event; without the layer nothing is inspected. */
export class InspectionRunner extends Context.Reference<InspectionRunnerService>(
  "polaris/daemon/constellation/InspectionRunner",
  { defaultValue: () => ({ refresh: () => Effect.void }) }
) {}

const startId = (inspection: Inspection) => CommandId.make(`${inspection.id}:start`);

const held = (model: ReadModel, id: ConstellationId, attemptId: Attempt["id"], key: string) => {
  const attempt = model.constellations.get(id)?.graph.attempts.find((a) => a.id === attemptId);

  return attempt !== undefined && inspecting(attempt) && attempt.inspection?.id === key;
};

const working = (session: SessionRecord | undefined) =>
  session?.turns.some((t) => t.status === "working") === true;

/** The Inspector's session: the Constellation's own, on the worker's checkout when it is local. */
const inspectorSession = Effect.fnUntraced(function* (
  graph: Constellation,
  attempt: Attempt,
  inspection: Inspection,
  model: ReadModel,
  defaultsPath: string
) {
  const lead = model.sessions.get(graph.leadSessionId)?.session;

  const defaults = yield* getDefaults.pipe(
    Effect.provideService(ConstellationDefaultsPath, defaultsPath)
  );

  const at = new Date().toISOString();

  return new AgentSession({
    id: inspection.sessionId,
    workspaceId: graph.workspaceId,
    ...selectWorker(null, null, graph.settings.inspector ?? defaults.inspector, lead ?? BUILT_IN),
    cwd: attempt.hostId === graph.hostId ? attempt.worktree : (lead?.cwd ?? attempt.worktree),
    worktreeId: null,
    title: `${attempt.taskId} · inspection`,
    state: "dormant",
    // The Supervisor opens an Inspector read-only whatever this says (supervisor.inspector.ts).
    permissionMode: "plan",
    celestial: pickCelestial(model.sessions.values(), {
      id: inspection.sessionId,
      workspaceId: graph.workspaceId,
    }),
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    worker: { constellationId: graph.id, role: "inspector" },
    createdAt: at,
    updatedAt: at,
  });
});

const make = Effect.gen(function* () {
  const logbook = yield* InspectorLogbookReader;
  const fetchedHead = yield* InspectorFetchedHead;
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;
  const effects = yield* ConstellationSessionEffects;
  const harness = yield* ConstellationHarness;
  const scope = yield* Scope.Scope;
  // Read where the runner is built: its start jobs run forked, outside the caller's context.
  const defaultsPath = yield* ConstellationDefaultsPath;
  const starting = new Set<string>();
  const closing = new Set<SessionId>();

  const lost = (id: ConstellationId, attempt: Attempt, inspection: Inspection, reason: string) =>
    // Fenced: a verdict mid-merge commits first, and this release then finds nothing pending.
    fenced(
      store,
      id,
      commitJournal(id, {
        type: "inspectionLost",
        attemptId: attempt.id,
        inspectionId: inspection.id,
        reason,
      })
    ).pipe(
      Effect.provideService(EventStore, store),
      Effect.provideService(ConstellationOwner, owner),
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.logError("Inspection could not be released", cause))
    );

  /** True once the claimed head is in `repo`; null when the Inspection ended; else why not. */
  const remoteHead = Effect.fnUntraced(function* (
    graph: Constellation,
    attempt: Attempt,
    inspection: Inspection,
    repo: string
  ) {
    for (let look = 0; look < REMOTE_HEAD_WAIT.looks; look++) {
      if (!held(yield* store.model, graph.id, attempt.id, inspection.id)) return null;

      if (yield* fetchedHead(repo, graph, attempt, inspection.head)) return true as const;
      yield* Effect.sleep(REMOTE_HEAD_WAIT.every);
    }

    return `its commit ${inspection.head} never reached this host`;
  });

  /** Create the session, then commit its first Turn while the Inspection still holds the Claim. */
  const start = Effect.fnUntraced(function* (
    graph: Constellation,
    attempt: Attempt,
    inspection: Inspection
  ) {
    const task = graph.tasks.find((t) => t.id === attempt.taskId);
    const claim = attempt.claim;

    if (task === undefined || claim === null) return "no Claim to read";

    const session = yield* inspectorSession(
      graph,
      attempt,
      inspection,
      yield* store.model,
      defaultsPath
    );

    // A Harness that can't hold an Inspector to its checkout never gets the session.
    const refusal = inspectorRefusal(driverCapabilities(session.harness), session.harness);

    if (refusal !== null) return refusal.message;

    if (!(yield* harness.probe())) return "the Polaris MCP endpoint did not answer";

    // A remote worker's commits arrive after its Claim: nothing is judged before they do.
    if (attempt.hostId !== graph.hostId) {
      const arrived = yield* remoteHead(graph, attempt, inspection, session.cwd);

      if (arrived !== true) return arrived;
    }

    yield* store.commit({
      commandId: CommandId.make(`${inspection.id}:session`),
      decide: (current) =>
        Effect.succeed(
          current.sessions.has(session.id)
            ? []
            : decideSession(undefined, { type: "session.fork", session }).events
        ),
    });

    const prompt = inspectorBrief({
      task,
      attempt,
      claim,
      inspection,
      diff: yield* claimDiff(session.cwd, attempt.base, claim.head),
      logbook: yield* logbook(graph.id, attempt.taskId),
    });

    const result = yield* store
      .commit({
        recordRejection: false,
        commandId: startId(inspection),
        decide: (current) => {
          const record = current.sessions.get(session.id);

          const decision =
            record === undefined || !held(current, graph.id, attempt.id, inspection.id)
              ? null
              : decideSession(record, {
                  type: "turn.send",
                  turn: newTurn(
                    record.session,
                    prompt,
                    new Date().toISOString(),
                    `${inspection.id}:start`
                  ),
                });

          return decision === null || decision.rejection !== null
            ? Effect.fail(
                new CommandRejected({
                  commandId: startId(inspection),
                  reason: "The Inspection is over",
                })
              )
            : Effect.succeed(decision.events);
        },
      })
      .pipe(Effect.catchTag("CommandRejected", () => Effect.succeed(null)));

    // A refused start is an Inspection already over, or a session that can't take a Turn.
    if (result === null)
      return held(yield* store.model, graph.id, attempt.id, inspection.id)
        ? "its session could not start a Turn"
        : null;

    const turn = Predicate.isTagged(result, "Committed")
      ? startedTurn(result.envelopes.map((e) => e.event))
      : undefined;

    if (turn !== undefined) yield* effects.runTurn(turn, prompt);

    return null;
  });

  const ensureStarted = Effect.fnUntraced(function* (
    graph: Constellation,
    attempt: Attempt,
    inspection: Inspection
  ) {
    if (starting.has(inspection.id)) return;
    starting.add(inspection.id);

    yield* start(graph, attempt, inspection).pipe(
      Effect.catchCause((cause) =>
        Effect.as(Effect.logError("Inspector did not start", cause), "its session failed to start")
      ),
      Effect.flatMap((reason) =>
        reason === null ? Effect.void : lost(graph.id, attempt, inspection, reason)
      ),
      Effect.ensuring(Effect.sync(() => starting.delete(inspection.id))),
      Effect.forkIn(scope)
    );
  });

  /** An Inspector whose Inspection is over: stop its Turn, then archive its session. */
  const close = Effect.fnUntraced(function* (session: SessionRecord) {
    const id = session.session.id;

    if (working(session)) {
      if (closing.has(id)) return;
      closing.add(id);
      yield* effects.interrupt(id);

      return;
    }

    closing.delete(id);

    yield* store
      .commit({
        commandId: null,
        decide: (current) => {
          const record = current.sessions.get(id);

          return Effect.succeed(
            record === undefined || working(record)
              ? []
              : decideSession(record, { type: "session.archive", at: new Date().toISOString() })
                  .events
          );
        },
      })
      .pipe(Effect.andThen(effects.retire(id)));
  });

  const reconcile = Effect.fnUntraced(function* (
    graph: Constellation,
    attempt: Attempt,
    inspection: Inspection
  ) {
    const session = (yield* store.model).sessions.get(inspection.sessionId);

    const over = graph.state === "completed" || graph.state === "archived";

    if (over || !inspecting(attempt)) {
      if (session !== undefined && session.session.state !== "archived") yield* close(session);

      return;
    }

    if (graph.state === "paused" || starting.has(inspection.id)) return;

    if (!(yield* store.hasCommandReceipt(startId(inspection)))) {
      yield* ensureStarted(graph, attempt, inspection);

      return;
    }

    // Started, its Turn over, and still no verdict: the Claim goes to the Lead.
    if (!working(session))
      yield* lost(
        graph.id,
        attempt,
        inspection,
        session?.session.state === "failed"
          ? (session.session.lastError ?? "its Harness failed")
          : "its Turn ended without a verdict"
      );
  });

  /** Inspectors a newer Claim replaced: no Attempt names them, so their Turn is stopped here. */
  const closeReplaced = Effect.fnUntraced(function* (graph: Constellation) {
    const named = new Set(graph.attempts.map((a) => a.inspection?.sessionId));

    for (const session of (yield* store.model).sessions.values())
      if (
        session.session.worker?.constellationId === graph.id &&
        session.session.worker.role === "inspector" &&
        session.session.state !== "archived" &&
        !named.has(session.session.id)
      )
        yield* close(session);
  });

  const refresh = Effect.fn("Constellation.refreshInspections")(function* (id: ConstellationId) {
    const graph = (yield* store.model).constellations.get(id)?.graph;

    if (graph === undefined || graph.hostId !== owner) return;

    for (const attempt of graph.attempts)
      if (attempt.inspection != null) yield* reconcile(graph, attempt, attempt.inspection);

    yield* closeReplaced(graph);
  });

  return {
    refresh: (id) =>
      refresh(id).pipe(
        Effect.catchCause((cause) => Effect.logError("Inspection refresh failed", cause))
      ),
  } satisfies InspectionRunnerService;
});

/** The runner over the store, the session effects and the composed Logbook reader. */
export const inspectionRunnerLayer = Layer.effect(InspectionRunner, make);
