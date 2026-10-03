/**
 * Fakes for engine tests: a scriptable Harness driver and in-memory
 * Checkpoints, WorktreeTracker and AttachmentStore. Not used in production.
 */
import { tempDirectory } from "../verification/tempDirectories.testing.ts";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApprovalDecision,
  Attachment,
  AttachmentId,
  CommandId,
  type HarnessKind,
  type RequestId,
  type SessionId,
  TurnItem,
} from "@polaris/protocol";
import { type Cause, Duration, Effect, Layer, Queue, Stream } from "effect";
import type { CheckpointPolicy } from "../git/prune.ts";
import {
  type HarnessDriver,
  HarnessEvent,
  type OpenOptions,
  type TurnInput,
} from "../harness/HarnessDriver.ts";
import {
  AttachmentStore,
  Checkpoints,
  HarnessRegistry,
  ReviewCheckoutGit,
  type WorktreeInfo,
  WorktreeTracker,
} from "../services.ts";
import { EventStore, StoreConfig } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";
import { Engine, EngineConfig, type EngineSettings } from "./Engine.ts";

// ── Harness ────────────────────────────────────────────────────────────────

export interface FakeHarnessSession {
  readonly options: OpenOptions;
  readonly turns: Array<TurnInput>;
  readonly responses: Array<{ requestId: RequestId; decision: ApprovalDecision }>;
  readonly steers: Array<string>;
  interrupts: number;
  closed: boolean;
  /** Push a Harness event, as if the vendor process emitted it. */
  readonly emit: (...events: ReadonlyArray<HarnessEvent>) => void;
}

export interface FakeDriver {
  readonly driver: HarnessDriver;
  readonly sessions: Array<FakeHarnessSession>;
  readonly latest: (sessionId: SessionId) => FakeHarnessSession | undefined;
  /** With `follow`: what the terminal UI reports while the session is In Terminal. */
  readonly follow: {
    readonly emit: (sessionId: SessionId, ...events: ReadonlyArray<HarnessEvent>) => void;
    readonly released: Array<SessionId>;
  };
}

export const makeFakeDriver = (
  kind: HarnessKind,
  options: {
    readonly steer?: boolean;
    readonly liveCoAttach?: boolean;
    readonly switchModel?: boolean;
    /** Events emitted in reply to each Turn; default is none (the test drives it). */
    readonly onTurn?: (
      input: TurnInput,
      session: FakeHarnessSession
    ) => ReadonlyArray<HarnessEvent>;
    readonly onInterrupt?: (session: FakeHarnessSession) => ReadonlyArray<HarnessEvent>;
    /** Offer `terminalFollow`, like Claude's hooks. */
    readonly follow?: boolean;
  } = {}
): FakeDriver => {
  const sessions: Array<FakeHarnessSession> = [];
  const followQueues = new Map<SessionId, Queue.Queue<HarnessEvent, Cause.Done>>();

  const followQueue = (sessionId: SessionId) => {
    let queue = followQueues.get(sessionId);

    if (queue === undefined) {
      queue = Effect.runSync(Queue.unbounded<HarnessEvent, Cause.Done>());
      followQueues.set(sessionId, queue);
    }

    return queue;
  };

  const released: Array<SessionId> = [];

  const terminalFollow: HarnessDriver["terminalFollow"] = {
    events: (sessionId: SessionId) => Stream.fromQueue(followQueue(sessionId)),
    release: (sessionId: SessionId) =>
      Effect.sync(() => {
        released.push(sessionId);
        Queue.endUnsafe(followQueue(sessionId));
        followQueues.delete(sessionId);
      }),
  };

  const withoutFollow: HarnessDriver = {
    kind,
    capabilities: {
      steer: options.steer ?? false,
      liveCoAttach: options.liveCoAttach ?? false,
      switchModel: options.switchModel ?? true,
    },
    probe: Effect.succeed({ available: true, version: "fake", detail: null }),
    open: (openOptions) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<HarnessEvent, Cause.Done>();

        let activeTurn: TurnInput["turnId"] | null = null;

        const session: FakeHarnessSession = {
          options: openOptions,
          turns: [],
          responses: [],
          steers: [],
          interrupts: 0,
          closed: false,
          emit: (...events) => {
            for (const event of events) {
              if (HarnessEvent.$is("TurnStarted")(event)) activeTurn = event.turnId;

              if (HarnessEvent.$is("TurnEnded")(event) && activeTurn === event.turnId)
                activeTurn = null;
              Queue.offerUnsafe(queue, event);
            }
          },
        };

        sessions.push(session);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            session.closed = true;
          }).pipe(Effect.andThen(Queue.end(queue)))
        );

        return {
          events: Stream.fromQueue(queue),
          sendTurn: (input) =>
            Effect.sync(() => {
              activeTurn = input.turnId;
              session.turns.push(input);
              session.emit(...(options.onTurn?.(input, session) ?? []));
            }),
          steerTurn: (input) =>
            Effect.sync(() => {
              if (activeTurn !== input.turnId) return false;
              session.turns.push(input);
              session.emit(...(options.onTurn?.(input, session) ?? []));

              return true;
            }),
          steer: (text) => Effect.sync(() => void session.steers.push(text)),
          interrupt: Effect.sync(() => {
            session.interrupts++;
            session.emit(...(options.onInterrupt?.(session) ?? []));
          }),
          respond: (requestId, decision) =>
            Effect.sync(() => void session.responses.push({ requestId, decision })),
          setPermissionMode: () => Effect.void,
          terminalCommand: Effect.succeed([kind, "--resume", openOptions.resumeCursor ?? "new"]),
        };
      }),
  };

  const driver: HarnessDriver = options.follow
    ? { ...withoutFollow, terminalFollow }
    : withoutFollow;

  return {
    driver,
    sessions,
    latest: (sessionId) => sessions.filter((s) => s.options.sessionId === sessionId).at(-1),
    follow: {
      emit: (sessionId, ...events) => {
        for (const event of events) Queue.offerUnsafe(followQueue(sessionId), event);
      },
      released,
    },
  };
};

/** Scripted reply: start the Turn, answer, complete. */
export const completesTurns =
  (cursor = "cursor-1") =>
  (input: TurnInput): ReadonlyArray<HarnessEvent> => [
    HarnessEvent.CursorAssigned({ cursor }),
    HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }),
    HarnessEvent.ItemCompleted({
      turnId: input.turnId,
      item: TurnItem.cases.AssistantMessage.make({
        id: `msg-${input.turnId}`,
        text: `re: ${input.prompt}`,
      }),
    }),
    HarnessEvent.TurnEnded({ turnId: input.turnId, status: "completed", error: null }),
  ];

// ── Services ───────────────────────────────────────────────────────────────

export interface Fakes {
  readonly checkpoints: Array<{ sessionId: SessionId; label: string }>;
  readonly worktrees: Map<string, Array<WorktreeInfo>>;
  readonly worktreeCalls: Array<{ op: "create" | "remove"; path: string; detail: unknown }>;
  readonly archived: Array<SessionId>;
  readonly attachments: Map<AttachmentId, Attachment>;
}

export const makeFakes = (): Fakes => ({
  checkpoints: [],
  worktrees: new Map(),
  worktreeCalls: [],
  archived: [],
  attachments: new Map(),
});

export const fakeServices = (fakes: Fakes, drivers: ReadonlyArray<FakeDriver>) =>
  Layer.mergeAll(
    Layer.succeed(Checkpoints)({
      capture: ({ sessionId, turnId, label }) =>
        Effect.sync(() => {
          fakes.checkpoints.push({ sessionId, label });

          return {
            ref: `refs/polaris/checkpoints/${sessionId}/${turnId}/${label}`,
            commit: `commit-${fakes.checkpoints.length}`,
          };
        }),
    }),
    Layer.succeed(WorktreeTracker)({
      list: (repoPath) => Effect.sync(() => fakes.worktrees.get(repoPath) ?? []),
      watch: () => Stream.empty,
      create: ({ repoPath, path, branch, baseRef }) =>
        Effect.sync(() => {
          const info: WorktreeInfo = { path, branch, head: "abc123", isMain: false };
          fakes.worktrees.set(repoPath, [...(fakes.worktrees.get(repoPath) ?? []), info]);
          fakes.worktreeCalls.push({ op: "create", path, detail: { branch, baseRef } });

          return info;
        }),
      remove: ({ repoPath, path, deleteBranchIfMerged }) =>
        Effect.sync(() => {
          fakes.worktrees.set(
            repoPath,
            (fakes.worktrees.get(repoPath) ?? []).filter((w) => w.path !== path)
          );
          fakes.worktreeCalls.push({ op: "remove", path, detail: { deleteBranchIfMerged } });
        }),
    }),
    Layer.succeed(AttachmentStore)({
      stage: (options) =>
        Effect.sync(() => {
          const attachment = new Attachment({
            id: AttachmentId.make(`att-${fakes.attachments.size + 1}`),
            name: options.name,
            mimeType: options.mimeType,
            size: options.bytes instanceof Uint8Array ? options.bytes.byteLength : 0,
            hostPath: `/staging/${options.name}`,
            width: null,
            height: null,
          });

          fakes.attachments.set(attachment.id, attachment);

          return attachment;
        }),
      get: (ids) => Effect.sync(() => ids.flatMap((id) => fakes.attachments.get(id) ?? [])),
      onSessionArchived: (sessionId) => Effect.sync(() => void fakes.archived.push(sessionId)),
    }),
    Layer.succeed(HarnessRegistry)({
      get: (kind) => {
        const found = drivers.find((d) => d.driver.kind === kind);

        return found
          ? Effect.succeed(found.driver)
          : Effect.die(new Error(`no fake driver for ${kind}`));
      },
      all: Effect.succeed(drivers.map((d) => d.driver)),
    })
  );

/**
 * Review Checkout git that never finishes a fetch or removal, so a test sees
 * the states the commands leave; tests of the git side provide `ReviewCheckoutGitLive`.
 */
export const pendingReviewCheckoutGit = Layer.succeed(ReviewCheckoutGit)({
  fetchPullRequest: () => Effect.never,
  pinCommits: () => Effect.never,
  ensure: () => Effect.void,
  inspect: () => Effect.succeed({ present: true, dirtyPaths: [], localCommits: 0 }),
  move: () => Effect.void,
  remove: () => Effect.never,
  markReviewed: () => Effect.void,
  interdiff: () => Effect.die(new Error("no interdiff in the pending fake")),
});

/** Engine + EventStore over `filename`, with fakes for everything else. */
export const engineLayer = (options: {
  readonly filename: string;
  readonly fakes: Fakes;
  readonly drivers: ReadonlyArray<FakeDriver>;
  readonly idleTimeout?: Duration.Input;
  readonly backgroundIdleTimeout?: Duration.Input;
  readonly checkpointPolicy?: CheckpointPolicy;
  /** The checkpoint sweeper is off unless a test sets this. */
  readonly checkpointSweepInterval?: Duration.Input;
  /** Items buffered per live subscriber (StoreConfig). */
  readonly subscriberCapacity?: number;
  /** Default: `pendingReviewCheckoutGit`. */
  readonly reviewCheckoutGit?: Layer.Layer<ReviewCheckoutGit>;
  /** Default: the fake, which writes no refs; `CheckpointsLive` snapshots real repositories. */
  readonly checkpoints?: Layer.Layer<Checkpoints>;
}) => {
  const store = EventStore.layerSqlite(options.filename).pipe(
    Layer.provide(
      Layer.succeed(StoreConfig)({ subscriberCapacity: options.subscriberCapacity ?? 4096 })
    )
  );

  const settings: EngineSettings = {
    idleTimeout: options.idleTimeout ?? Duration.minutes(30),
    backgroundIdleTimeout: options.backgroundIdleTimeout ?? Duration.hours(8),
    checkpointSweepInterval: options.checkpointSweepInterval ?? null,
  };

  return Engine.layer.pipe(
    Layer.provideMerge(store),
    Layer.provide(options.checkpoints ?? Layer.empty),
    Layer.provide(
      options.checkpoints === undefined
        ? fakeServices(options.fakes, options.drivers)
        : Layer.merge(fakeServices(options.fakes, options.drivers), options.checkpoints)
    ),
    Layer.provide(options.reviewCheckoutGit ?? pendingReviewCheckoutGit),
    Layer.provide(
      Layer.succeed(EngineConfig)(
        options.checkpointPolicy === undefined
          ? settings
          : { ...settings, checkpointPolicy: options.checkpointPolicy }
      )
    )
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

export const tempDir = (): string => tempDirectory(join(tmpdir(), "polaris-engine-"));

/** A directory that looks like a git repository to RegisterWorkspace. */
export const fakeRepo = (root = tempDir()): string => {
  const dir = join(root, "repo");
  mkdirSync(join(dir, ".git"), { recursive: true });

  return dir;
};

let commandCounter = 0;

export const cid = (label = "cmd"): CommandId => CommandId.make(`${label}-${++commandCounter}`);

/** Poll the read model until `predicate` holds (reactors run after the ack). */
export const waitFor = (predicate: (model: ReadModel) => boolean, timeout = 2000) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const deadline = Date.now() + timeout;

    while (true) {
      const model = yield* store.model;

      if (predicate(model)) return model;

      if (Date.now() > deadline) return yield* Effect.die(new Error("waitFor timed out"));
      yield* Effect.sleep(Duration.millis(5));
    }
  });

/** Wait for a plain condition outside the read model (e.g. a fake's call log). */
export const waitUntil = (condition: () => boolean, timeout = 2000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeout;

    while (!condition()) {
      if (Date.now() > deadline) return yield* Effect.die(new Error("waitUntil timed out"));
      yield* Effect.sleep(Duration.millis(5));
    }
  });
