/**
 * Driving a Daemon like a Client does: dispatch commands, register Workspaces,
 * start scripted Agent Sessions, and watch session streams while recording
 * when things arrive.
 */
import {
  ApprovalDecision,
  Command,
  CommandId,
  DomainEvent,
  type HarnessKind,
  HostStreamItem,
  type Sequence,
  SessionId,
  SessionPlacement,
  type SessionState,
  SessionStreamItem,
  type WorkspaceId,
} from "@polaris/protocol";
import { Duration, Effect, Option, type Scope, Stream } from "effect";
import type { Client } from "./daemon.ts";

/**
 * Mirrors `BenchTurnScript` in apps/daemon/src/harness/bench/BenchDriver.ts:
 * the scripted Harness reads it from a `bench:{json}` prompt.
 */
export interface TurnScript {
  readonly items?: number;
  readonly deltasPerItem?: number;
  readonly deltaBytes?: number;
  readonly deltaIntervalMs?: number;
  readonly approvalEvery?: number;
  readonly touchFiles?: number;
  readonly itemBytes?: number;
  readonly startDelayMs?: number;
}

export const prompt = (script: TurnScript) => `bench:${JSON.stringify(script)}`;

let counter = 0;

export const commandId = () => CommandId.make(`bench-${process.pid}-${++counter}`);

export const dispatch = (client: Client, command: Command) =>
  client.connection.client.dispatch({ commandId: commandId(), command });

/** Register `path` and return its Workspace id. */
export const registerWorkspace = (client: Client, path: string, name: string) =>
  Effect.gen(function* () {
    yield* dispatch(client, Command.cases.RegisterWorkspace.make({ path, name }));

    const snapshot = yield* client.connection.client
      .subscribeHost({ afterSequence: null })
      .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

    const workspace = Option.getOrUndefined(snapshot)?.workspaces.find((w) => w.name === name);

    if (workspace === undefined) return yield* Effect.die(new Error(`${name} not registered`));

    return workspace.id;
  });

export const startSession = (
  client: Client,
  options: {
    readonly sessionId: string;
    readonly workspaceId: WorkspaceId;
    readonly script: TurnScript;
    readonly harness?: HarnessKind;
  }
) =>
  dispatch(
    client,
    Command.cases.StartSession.make({
      sessionId: SessionId.make(options.sessionId),
      workspaceId: options.workspaceId,
      harness: options.harness ?? "codex",
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "supervised",
      model: null,
      prompt: prompt(options.script),
      attachments: [],
    })
  );

export const sendTurn = (client: Client, sessionId: string, script: TurnScript) =>
  dispatch(
    client,
    Command.cases.SendTurn.make({
      sessionId: SessionId.make(sessionId),
      prompt: prompt(script),
      attachments: [],
    })
  );

export interface SessionWatch {
  readonly sessionId: string;
  state: SessionState | null;
  /** Arrival time (performance.now) of each TurnStarted, in order. */
  readonly turnStarted: Array<number>;
  /** Arrival time of each TurnEnded, in order. */
  readonly turnEnded: Array<number>;
  events: number;
  deltas: number;
  deltaBytes: number;
  lastSequence: number;
  /** Sequence of each TurnEnded event, in order. */
  readonly turnEndedSequences: Array<number>;
  /** Arrival times of CheckpointRecorded events, with their refs and the last item's arrival before. */
  readonly checkpoints: Array<{
    readonly at: number;
    readonly ref: string;
    readonly lastItemAt: number;
  }>;
  /** Arrival time of the last TurnItemCompleted. */
  lastItemAt: number;
  snapshotAt: number | null;
  synchronizedAt: number | null;
  /** Items in the first snapshot. */
  snapshotTurns: number;
}

export interface WatchOptions {
  /** Answer every approval with Allow (only one Client should). */
  readonly autoApprove?: boolean;
  /** Harness emit → Client receive latency of every delta, ms. */
  readonly deltaLatencies?: Array<number>;
  /** Commit → Client receive latency of every event, ms (1 ms resolution). */
  readonly eventLatencies?: Array<number>;
  /** Approval request → resolution arrival, ms. */
  readonly approvalRoundTrips?: Array<number>;
  readonly afterSequence?: Sequence | null;
  readonly turnLimit?: number | null;
}

const nowEpoch = () => performance.timeOrigin + performance.now();

/** What the stream handlers of one `watchSession` share; `at` is the current item's arrival. */
interface WatchContext {
  readonly client: Client;
  readonly watch: SessionWatch;
  readonly options: WatchOptions;
  readonly approvalsOpened: Map<string, number>;
  at: number;
}

type SessionSnapshot = typeof SessionStreamItem.cases.Snapshot.Type;

type SessionDelta = typeof SessionStreamItem.cases.Delta.Type;

const onSnapshot = (ctx: WatchContext, item: SessionSnapshot) => {
  const { watch, at } = ctx;
  watch.snapshotAt ??= at;
  watch.state = item.session.state;
  watch.lastSequence = item.sequence;
  watch.snapshotTurns = item.turns.length;

  // Turns already in the snapshot count as started (and ended) on arrival.
  if (watch.turnStarted.length === 0) {
    for (const detail of item.turns) {
      watch.turnStarted.push(at);

      if (detail.turn.status !== "working") watch.turnEnded.push(at);
    }
  }

  return Effect.void;
};

const onDelta = (ctx: WatchContext, item: SessionDelta) => {
  const { watch, options } = ctx;
  watch.deltas++;
  watch.deltaBytes += item.text.length;

  if (options.deltaLatencies && item.text.charCodeAt(0) === 64 /* @ */) {
    const emitted = Number(item.text.slice(1, item.text.indexOf("|")));

    if (emitted > 0) options.deltaLatencies.push(nowEpoch() - emitted);
  }

  return Effect.void;
};

/** The domain events a watch records (after `lastSequence` is set); others are ignored. */
const eventHandler = (ctx: WatchContext) => {
  const { client, watch, options, approvalsOpened } = ctx;

  return DomainEvent.matchOrElse<Effect.Effect<void>>(
    {
      SessionStateChanged: (event) => {
        watch.state = event.state;

        return Effect.void;
      },
      TurnStarted: () => {
        watch.turnStarted.push(ctx.at);

        return Effect.void;
      },
      TurnEnded: () => {
        watch.turnEnded.push(ctx.at);
        watch.turnEndedSequences.push(watch.lastSequence);

        return Effect.void;
      },
      TurnItemCompleted: () => {
        watch.lastItemAt = ctx.at;

        return Effect.void;
      },
      CheckpointRecorded: (event) => {
        watch.checkpoints.push({ at: ctx.at, ref: event.ref, lastItemAt: watch.lastItemAt });

        return Effect.void;
      },
      ApprovalRequested: (event) => {
        approvalsOpened.set(event.request.id, ctx.at);

        if (!options.autoApprove) return Effect.void;

        return dispatch(
          client,
          Command.cases.RespondToApproval.make({
            sessionId: event.request.sessionId,
            requestId: event.request.id,
            decision: ApprovalDecision.cases.Allow.make({ remember: false }),
          })
        ).pipe(Effect.ignore);
      },
      ApprovalResolved: (event) => {
        const opened = approvalsOpened.get(event.requestId);

        if (opened !== undefined) options.approvalRoundTrips?.push(ctx.at - opened);

        return Effect.void;
      },
    },
    () => Effect.void
  );
};

/** Handles one session stream item, recording into `ctx.watch`. */
const itemHandler = (ctx: WatchContext) => {
  const onEvent = eventHandler(ctx);

  return SessionStreamItem.match({
    Snapshot: (item) => onSnapshot(ctx, item),
    Synchronized: () => {
      ctx.watch.synchronizedAt ??= ctx.at;

      return Effect.void;
    },
    Delta: (item) => onDelta(ctx, item),
    Event: (item) => {
      ctx.watch.events++;
      ctx.watch.lastSequence = item.envelope.sequence;
      ctx.options.eventLatencies?.push(Date.now() - Date.parse(item.envelope.occurredAt));

      return onEvent(item.envelope.event);
    },
    // Live-only progress: not measured here.
    ItemProgress: () => Effect.void,
  });
};

/** Subscribe to a session stream in the background; the returned object fills in as items arrive. */
export const watchSession = (
  client: Client,
  sessionId: string,
  options: WatchOptions = {}
): Effect.Effect<SessionWatch, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watch: SessionWatch = {
      sessionId,
      state: null,
      turnStarted: [],
      turnEnded: [],
      events: 0,
      deltas: 0,
      deltaBytes: 0,
      lastSequence: 0,
      turnEndedSequences: [],
      checkpoints: [],
      lastItemAt: 0,
      snapshotAt: null,
      synchronizedAt: null,
      snapshotTurns: 0,
    };

    const ctx: WatchContext = { client, watch, options, approvalsOpened: new Map(), at: 0 };
    const handle = itemHandler(ctx);

    yield* client.connection.client
      .subscribeSession({
        sessionId: SessionId.make(sessionId),
        afterSequence: options.afterSequence ?? null,
        turnLimit: options.turnLimit ?? null,
      })
      .pipe(
        Stream.runForEach((item) =>
          Effect.suspend(() => {
            ctx.at = performance.now();

            return handle(item);
          })
        ),
        Effect.ignore,
        Effect.forkScoped
      );

    return watch;
  });

/** Poll `condition` every 5 ms until it holds. */
export const waitUntil = (condition: () => boolean, timeoutMs: number, what: string) =>
  Effect.gen(function* () {
    const deadline = performance.now() + timeoutMs;

    while (!condition()) {
      if (performance.now() > deadline) {
        return yield* Effect.fail(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }

      yield* Effect.sleep(Duration.millis(5));
    }
  });

export const settle = (ms: number) => Effect.sleep(Duration.millis(ms));
