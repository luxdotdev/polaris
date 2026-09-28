/**
 * The orchestration engine: decides commands, records them, and supervises
 * each Agent Session's Harness.
 *
 *   dispatch ─▶ decide (under the commit lock) ─▶ commit ─▶ ack
 *                                                  └─▶ reactor (after commit, per-session serial)
 *   Harness events ─▶ session machine (session.ts) ─▶ commit ─▶ its effects
 *
 * An ack means the intent is recorded; the reactor opens Harnesses, captures
 * checkpoints, creates or removes Worktrees and so on. Nothing here writes
 * to the database except through `EventStore.commit`.
 */
import { statSync } from "node:fs"
import { join } from "node:path"
import {
  type AgentSession,
  type ApprovalDecision,
  ApprovalRequest,
  type Attachment,
  type Command,
  type CommandId,
  CommandRejected,
  DomainEvent,
  type EventEnvelope,
  type HostStreamItem,
  NotFound,
  type Sequence,
  type SessionId,
  type SessionStreamItem,
  SessionSummary,
  TerminalLaunch,
  type Turn,
  TurnDetail,
  TurnId,
  type TurnItem,
  type Workspace,
  WorkspaceId,
  Worktree,
} from "@polaris/protocol"
import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Result,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import {
  type CheckpointPolicy,
  type CheckpointSession,
  DEFAULT_CHECKPOINT_POLICY,
  dropSessionCheckpoints,
  onSessionArchived as pruneArchivedSession,
  runCheckpointSweeper,
  type SweepTarget,
} from "../git/prune.ts"
import type { HarnessDriver, HarnessEvent, HarnessSession } from "../harness/HarnessDriver.ts"
import { registerHandoffContributor } from "../service/upgrade.ts"
import {
  AttachmentStore,
  Checkpoints,
  HarnessRegistry,
  type ServiceError,
  WorktreeTracker,
} from "../services.ts"
import { type CommitResult, EventStore, type LiveItem } from "../store/EventStore.ts"
import { isHostStreamEvent, lastTurn, type ReadModel, type SessionRecord } from "../store/model.ts"
import { CONTINUE_PROMPT, decide, forkBranch, worktreeIdFor } from "./decider.ts"
import { finalReply, forkPreamble } from "./fork.ts"
import { decideSession, type SessionEffect, type SessionInput } from "./session.ts"

export interface EngineSettings {
  /** How long an Idle session keeps its Harness process before going Dormant. */
  readonly idleTimeout: Duration.Input
  /** Checkpoint pruning policy (`git/prune.ts`); `DEFAULT_CHECKPOINT_POLICY` when unset. */
  readonly checkpointPolicy?: CheckpointPolicy
  /** How often the checkpoint sweeper runs (6 hours when unset); null turns it off. */
  readonly checkpointSweepInterval?: Duration.Input | null
}

export const EngineConfig = Context.Reference<EngineSettings>(
  "polaris/daemon/engine/EngineConfig",
  {
    defaultValue: () => ({ idleTimeout: Duration.minutes(30) }),
  },
)

export class Engine extends Context.Service<
  Engine,
  {
    readonly dispatch: (options: {
      readonly commandId: CommandId
      readonly command: Command
      /** Label of the sending Client device, from its `hello`. */
      readonly deviceLabel: string
    }) => Effect.Effect<{ readonly sequence: Sequence | null }, CommandRejected | NotFound>
    readonly subscribeHost: (afterSequence: Sequence | null) => Stream.Stream<HostStreamItem>
    readonly subscribeSession: (options: {
      readonly sessionId: SessionId
      readonly afterSequence: Sequence | null
      readonly turnLimit: number | null
      /** Send `ItemProgress` (the Client announced `session.live-items`). Default false. */
      readonly liveItems?: boolean
    }) => Stream.Stream<SessionStreamItem, NotFound>
    readonly hasSession: (sessionId: SessionId) => Effect.Effect<boolean>
    /** How to launch the Harness's own TUI for a session that is In Terminal, once known. */
    readonly terminalCommand: (sessionId: SessionId) => Effect.Effect<TerminalLaunch | null>
    /**
     * Call right before the Daemon replaces itself (execve upgrade). Harnesses that
     * live inside the Daemon process (Claude, `liveCoAttach: false`) are closed
     * cleanly: a Turn in flight ends Interrupted and its session Needs You (the
     * user continues it, as after a restart); other live sessions go Dormant and
     * resume from their cursor on the next Turn. Codex threads live in the shared
     * app-server, which outlives the Daemon, so they are left alone.
     */
    readonly prepareForUpgrade: Effect.Effect<void>
  }
>()("polaris/daemon/engine/Engine") {
  static readonly layer = Layer.effect(
    Engine,
    Effect.suspend(() => make),
  )
}

/** Something whose `HarnessEvent`s the engine consumes: a live Harness, or a terminal follower. */
interface EventSource {
  readonly scope: Scope.Closeable
  /** Set when Polaris stops the source on purpose, so its exit is not treated as a crash. */
  stopping: boolean
}

interface LiveHarness extends EventSource {
  readonly driver: HarnessDriver
  readonly session: HarnessSession
  consumer: Fiber.Fiber<void> | null
}

/** Follows a session's terminal UI while it is In Terminal (sequential hand-off). */
interface TerminalFollower extends EventSource {
  readonly driver: HarnessDriver
  fiber: Fiber.Fiber<void> | null
}

/** An item still in progress, as last reported by `ItemUpdated`. */
interface Progress {
  readonly turnId: TurnId
  readonly item: TurnItem
}

/** How long `ReturnFromTerminal` waits for the terminal follower to drain. */
const FOLLOWER_DRAIN = Duration.seconds(5)

const make = Effect.gen(function* () {
  const store = yield* EventStore
  const registry = yield* HarnessRegistry
  const checkpoints = yield* Checkpoints
  const worktrees = yield* WorktreeTracker
  const attachmentStore = yield* AttachmentStore
  const config = yield* EngineConfig
  const engineScope = yield* Effect.scope

  const live = new Map<SessionId, LiveHarness>()
  const terminalLaunch = new Map<SessionId, TerminalLaunch>()
  const followers = new Map<SessionId, TerminalFollower>()
  /** Items in progress per session, so a Client that subscribes mid-Turn sees them. */
  const progress = new Map<SessionId, Map<string, Progress>>()
  const idleTimers = yield* FiberMap.make<SessionId>()
  const sessionLocks = new Map<SessionId, Semaphore.Semaphore>()

  const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString())

  /** Reactor work and Harness lifecycle changes for one session run one at a time. */
  const serially =
    (sessionId: SessionId) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      let lock = sessionLocks.get(sessionId)
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1)
        sessionLocks.set(sessionId, lock)
      }
      return lock.withPermits(1)(effect)
    }

  /** Record events the Daemon decides on its own, against the session's latest state. */
  const recordFor = (
    sessionId: SessionId,
    f: (record: SessionRecord, model: ReadModel) => ReadonlyArray<DomainEvent>,
  ): Effect.Effect<CommitResult, ServiceError> =>
    store.commit({
      commandId: null,
      decide: (model) => {
        const record = model.sessions.get(sessionId)
        return Effect.succeed(record === undefined ? [] : f(record, model))
      },
    })

  /** Forget progress of items that can no longer complete (their Turn ended, the Harness went away). */
  const dropProgress = (sessionId: SessionId, turnId?: TurnId) => {
    const items = progress.get(sessionId)
    if (items === undefined) return
    for (const [id, entry] of items)
      if (turnId === undefined || entry.turnId === turnId) items.delete(id)
    if (items.size === 0) progress.delete(sessionId)
  }

  /**
   * Run one lifecycle input through the session machine against the session's
   * latest state, commit the events it emits, then run its effects. `input`
   * may read the record it is decided against.
   */
  const signal = (
    sessionId: SessionId,
    input: SessionInput | ((record: SessionRecord) => SessionInput),
  ): Effect.Effect<CommitResult, ServiceError> =>
    Effect.gen(function* () {
      let effects: ReadonlyArray<SessionEffect> = []
      const result = yield* recordFor(sessionId, (record) => {
        const decision = decideSession(record, typeof input === "function" ? input(record) : input)
        effects = decision.effects
        return decision.events
      })
      for (const effect of effects) {
        if (effect === "scheduleIdleStop") yield* scheduleIdle(sessionId)
        else yield* stopHarness(sessionId)
      }
      return result
    })

  /** The Turn in flight fails and the session goes Failed. */
  const failSession = (sessionId: SessionId, message: string) =>
    Effect.gen(function* () {
      const at = yield* now
      yield* Effect.logWarning(`session ${sessionId} failed: ${message}`)
      yield* signal(sessionId, { type: "session.fail", message, at })
    })

  const capture = (sessionId: SessionId, turnId: TurnId, label: "before" | "after") =>
    Effect.gen(function* () {
      const model = yield* store.model
      const record = model.sessions.get(sessionId)
      if (record === undefined) return null
      return yield* checkpoints.capture({ cwd: record.session.cwd, sessionId, turnId, label })
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`checkpoint ${label} of ${turnId} failed: ${error.message}`).pipe(
          Effect.as(null),
        ),
      ),
    )

  // ── Harness lifecycle ────────────────────────────────────────────────────

  const cancelIdle = (sessionId: SessionId) => FiberMap.remove(idleTimers, sessionId)

  const scheduleIdle = (sessionId: SessionId) =>
    FiberMap.run(
      idleTimers,
      sessionId,
      Effect.sleep(config.idleTimeout).pipe(
        Effect.andThen(serially(sessionId)(goDormant(sessionId))),
      ),
    ).pipe(Effect.asVoid)

  /** Stop the Harness on purpose. Never call from the session's own event consumer. */
  const stopHarness = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const entry = live.get(sessionId)
      if (entry === undefined) return
      entry.stopping = true
      live.delete(sessionId)
      dropProgress(sessionId)
      if (entry.consumer !== null) yield* Fiber.interrupt(entry.consumer)
      yield* Scope.close(entry.scope, Exit.void)
    })

  const goDormant = (sessionId: SessionId) =>
    signal(sessionId, () => ({ type: "idle.timeout", harnessLive: live.has(sessionId) })).pipe(
      Effect.catchCause((cause) => Effect.logError("idle stop failed", cause)),
    )

  const openHarness = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const existing = live.get(sessionId)
      if (existing !== undefined) return existing
      const model = yield* store.model
      const record = model.sessions.get(sessionId)
      if (record === undefined) {
        return yield* Effect.fail(new NotFound({ what: "session", id: sessionId }))
      }
      const driver = yield* registry.get(record.session.harness)
      const scope = yield* Scope.make()
      const session = yield* driver
        .open({
          sessionId,
          cwd: record.session.cwd,
          permissionMode: record.session.permissionMode,
          model: record.session.model,
          resumeCursor: record.session.harnessCursor,
        })
        .pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        )
      const entry: LiveHarness = { driver, session, scope, consumer: null, stopping: false }
      live.set(sessionId, entry)
      entry.consumer = yield* Effect.forkIn(consume(sessionId, entry), engineScope)
      return entry
    })

  const consume = (sessionId: SessionId, entry: LiveHarness): Effect.Effect<void> =>
    entry.session.events.pipe(
      Stream.runForEach((event) =>
        onHarnessEvent(sessionId, entry, event).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`handling ${event._tag} for ${sessionId} failed`, cause),
          ),
        ),
      ),
      // A stream that ends without `Exited` is a clean exit.
      Effect.andThen(
        Effect.suspend(() =>
          entry.stopping
            ? Effect.void
            : onHarnessEvent(sessionId, entry, { _tag: "Exited", error: null }).pipe(
                Effect.catchCause((cause) => Effect.logError("handling exit failed", cause)),
              ),
        ),
      ),
    )

  const onHarnessEvent = (
    sessionId: SessionId,
    entry: EventSource,
    event: HarnessEvent,
  ): Effect.Effect<void, ServiceError> =>
    // Deltas are most of what a Harness emits: publish them without the rest.
    event._tag === "ItemDelta"
      ? Effect.suspend(() =>
          entry.stopping
            ? Effect.void
            : store.publishEphemeral({
                _tag: "Delta",
                sessionId,
                turnId: event.turnId,
                itemId: event.itemId,
                field: event.field,
                text: event.text,
              }),
        )
      : onHarnessRecord(sessionId, entry, event)

  const onHarnessRecord = (sessionId: SessionId, entry: EventSource, event: HarnessEvent) =>
    Effect.gen(function* () {
      if (entry.stopping) return
      const at = yield* now
      switch (event._tag) {
        case "CursorAssigned":
          yield* recordFor(sessionId, (record) =>
            record.session.harnessCursor === event.cursor
              ? []
              : [
                  DomainEvent.cases.SessionCursorUpdated.make({
                    sessionId,
                    harnessCursor: event.cursor,
                  }),
                ],
          )
          return
        case "TurnStarted":
          // Turns Polaris sent are already recorded; others (e.g. typed in a co-attached TUI) are new.
          yield* signal(sessionId, {
            type: "harness.turnStarted",
            turnId: event.turnId,
            prompt: event.prompt ?? "",
            at,
          })
          yield* cancelIdle(sessionId)
          return
        case "ItemDelta":
          return // handled by onHarnessEvent
        case "ItemUpdated": {
          const items = progress.get(sessionId) ?? new Map<string, Progress>()
          items.set(event.item.id, { turnId: event.turnId, item: event.item })
          progress.set(sessionId, items)
          yield* store.publishEphemeral({
            _tag: "ItemProgress",
            sessionId,
            turnId: event.turnId,
            item: event.item,
          })
          return
        }
        case "ItemCompleted":
          progress.get(sessionId)?.delete(event.item.id)
          yield* recordFor(sessionId, () => [
            DomainEvent.cases.TurnItemCompleted.make({
              sessionId,
              turnId: event.turnId,
              item: event.item,
            }),
          ])
          return
        case "ApprovalRequested":
          yield* signal(sessionId, {
            type: "harness.approvalRequested",
            request: new ApprovalRequest({
              id: event.requestId,
              sessionId,
              turnId: event.turnId,
              kind: event.kind,
              title: event.title,
              detail: event.detail,
              options: [...event.options],
              openedAt: at,
            }),
          })
          return
        case "ApprovalWithdrawn":
          yield* signal(sessionId, {
            type: "harness.approvalWithdrawn",
            requestId: event.requestId,
          })
          return
        case "TurnEnded": {
          dropProgress(sessionId, event.turnId)
          const after = yield* capture(sessionId, event.turnId, "after")
          yield* signal(sessionId, {
            type: "harness.turnEnded",
            turnId: event.turnId,
            status: event.status,
            error: event.error,
            checkpoint: after,
            at,
          })
          return
        }
        case "TitleSuggested":
          yield* recordFor(sessionId, (record) =>
            record.titleLocked || record.session.title === event.title
              ? []
              : [DomainEvent.cases.SessionRenamed.make({ sessionId, title: event.title })],
          )
          return
        case "WorktreeCreated": {
          const model = yield* store.model
          const record = model.sessions.get(sessionId)
          const workspace = record && model.workspaces.get(record.session.workspaceId)
          if (workspace === undefined) return
          const listed = yield* worktrees
            .list(workspace.path)
            .pipe(Effect.catch(() => Effect.succeed([])))
          const info = listed.find((w) => w.path === event.path)
          yield* recordFor(sessionId, () => [
            DomainEvent.cases.WorktreeDetected.make({
              worktree: new Worktree({
                id: worktreeIdFor(event.path),
                workspaceId: workspace.id,
                path: event.path,
                branch: info?.branch ?? null,
                head: info?.head ?? "",
                createdBySessionId: sessionId,
                isMain: info?.isMain ?? false,
              }),
            }),
          ])
          return
        }
        case "Exited": {
          entry.stopping = true
          if (live.get(sessionId) === entry) live.delete(sessionId)
          dropProgress(sessionId)
          yield* cancelIdle(sessionId)
          yield* Scope.close(entry.scope, Exit.void)
          yield* signal(sessionId, { type: "harness.exited", error: event.error, at })
          return
        }
      }
    })

  /** Capture the before-checkpoint, make sure the Harness runs, and hand it the Turn. */
  const runTurn = (
    sessionId: SessionId,
    turnId: TurnId,
    prompt: string,
    attachments: ReadonlyArray<Attachment>,
  ) =>
    Effect.gen(function* () {
      yield* cancelIdle(sessionId)
      const model = yield* store.model
      const turn = model.sessions.get(sessionId)?.turns.find((t) => t.id === turnId)
      if (turn === undefined || turn.status !== "working") return
      if (turn.checkpointBefore === null) {
        const before = yield* capture(sessionId, turnId, "before")
        if (before !== null) {
          yield* recordFor(sessionId, () => [
            DomainEvent.cases.CheckpointRecorded.make({
              sessionId,
              turnId,
              ref: before.ref,
              commit: before.commit,
            }),
          ])
        }
      }
      // Before opening: a Harness may report its cursor as soon as it opens.
      const session = (yield* store.model).sessions.get(sessionId)?.session
      const input =
        session !== undefined && session.parentSessionId !== null && session.harnessCursor === null
          ? yield* withForkContext(session, prompt)
          : prompt
      const entry = yield* openHarness(sessionId)
      yield* signal(sessionId, { type: "harness.opened" })
      yield* entry.session.sendTurn({ turnId, prompt: input, attachments })
    }).pipe(Effect.catch((error) => failSession(sessionId, messageOf(error))))

  /** A Fork's Harness starts fresh: prefix its first Turn with the parent's conversation (fork.ts). */
  const withForkContext = (session: AgentSession, prompt: string) =>
    Effect.gen(function* () {
      const parentId = session.parentSessionId!
      const model = yield* store.model
      const parent = model.sessions.get(parentId)
      const turns = yield* store.readTurns({ sessionId: parentId, beforeIndex: null, limit: null })
      const at = turns.findIndex((t) => t.id === session.forkedFromTurnId)
      const included = at === -1 ? turns : turns.slice(0, at + 1)
      const items = yield* store.readTurnItems({
        turnIds: included.map((t) => t.id),
        upTo: model.sequence,
      })
      return forkPreamble({
        parentTitle: parent?.session.title ?? parentId,
        ownWorktree:
          session.worktreeId !== null && session.worktreeId !== parent?.session.worktreeId,
        turns: included.map((t) => ({ prompt: t.prompt, reply: finalReply(items.get(t.id)) })),
        prompt,
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.as(Effect.logWarning(`fork context for ${session.id}: ${error.message}`), prompt),
      ),
    )

  // ── Reactors (after commit) ──────────────────────────────────────────────

  const turnFrom = (envelopes: ReadonlyArray<EventEnvelope>): Turn | undefined => {
    for (const envelope of envelopes) {
      if (envelope.event._tag === "TurnStarted") return envelope.event.turn
    }
    return undefined
  }

  const react = (
    command: Command,
    result: Extract<CommitResult, { _tag: "Committed" }>,
    /** The model the command was decided against. */
    before: ReadModel,
  ): Effect.Effect<void, unknown> => {
    switch (command._tag) {
      case "RegisterWorkspace":
        return Effect.gen(function* () {
          const workspace = result.envelopes
            .map((e) => e.event)
            .find((e) => e._tag === "WorkspaceRegistered")?.workspace
          if (workspace === undefined || !workspace.isGitRepo) return
          const listed = yield* worktrees.list(workspace.path)
          yield* store.commit({
            commandId: null,
            decide: (model) =>
              Effect.succeed(
                listed
                  .filter((info) => !model.worktrees.has(worktreeIdFor(info.path)))
                  .map((info) =>
                    DomainEvent.cases.WorktreeDetected.make({
                      worktree: new Worktree({
                        id: worktreeIdFor(info.path),
                        workspaceId: workspace.id,
                        path: info.path,
                        branch: info.branch,
                        head: info.head,
                        createdBySessionId: null,
                        isMain: info.isMain,
                      }),
                    }),
                  ),
              ),
          })
        })

      case "StartSession":
        return Effect.gen(function* () {
          const record = result.model.sessions.get(command.sessionId)
          const workspace = result.model.workspaces.get(command.workspaceId)
          const turn = turnFrom(result.envelopes)
          if (record === undefined || workspace === undefined || turn === undefined) return
          if (command.placement._tag === "NewWorktree") {
            const created = yield* createWorktree(command.sessionId, workspace, {
              path: record.session.cwd,
              branch: command.placement.branch.trim(),
              baseRef: command.placement.baseRef,
            })
            if (!created) return
          }
          yield* runTurn(command.sessionId, turn.id, turn.prompt, turn.attachments)
        })

      case "SendTurn": {
        const turn = turnFrom(result.envelopes)
        return turn === undefined
          ? Effect.void
          : runTurn(command.sessionId, turn.id, turn.prompt, turn.attachments)
      }

      case "Continue": {
        const turn = turnFrom(result.envelopes)
        return turn === undefined
          ? Effect.void
          : runTurn(command.sessionId, turn.id, CONTINUE_PROMPT, [])
      }

      case "Steer":
        return Effect.suspend(
          () => live.get(command.sessionId)?.session.steer(command.text) ?? Effect.void,
        )

      case "Interrupt":
        return Effect.gen(function* () {
          const entry = live.get(command.sessionId)
          if (entry !== undefined) return yield* entry.session.interrupt
          // No Harness is running the Turn; end it here.
          yield* signal(command.sessionId, { type: "turn.interruptUnattended", at: yield* now })
        })

      case "RespondToApproval":
        return respond(command.sessionId, command.requestId, command.decision)

      case "SetPermissionMode":
        return Effect.suspend(
          () =>
            live.get(command.sessionId)?.session.setPermissionMode(command.permissionMode) ??
            Effect.void,
        )

      case "ArchiveSession":
        return Effect.gen(function* () {
          yield* cancelIdle(command.sessionId)
          yield* stopHarness(command.sessionId)
          yield* stopFollower(command.sessionId, false)
          terminalLaunch.delete(command.sessionId)
          const model = yield* store.model
          const record = model.sessions.get(command.sessionId)
          const worktree = record?.session.worktreeId
            ? model.worktrees.get(record.session.worktreeId)
            : undefined
          const workspace = record && model.workspaces.get(record.session.workspaceId)
          const sharedWithActive = [...model.sessions.values()].some(
            (other) =>
              other.session.id !== command.sessionId &&
              other.session.worktreeId === worktree?.id &&
              other.session.state !== "archived",
          )
          if (
            worktree !== undefined &&
            workspace !== undefined &&
            worktree.createdBySessionId === command.sessionId &&
            !worktree.isMain &&
            !sharedWithActive
          ) {
            yield* worktrees.remove({
              repoPath: workspace.path,
              path: worktree.path,
              deleteBranchIfMerged: command.deleteMergedBranch,
            })
            yield* recordFor(command.sessionId, () => [
              DomainEvent.cases.WorktreeRemoved.make({
                workspaceId: workspace.id,
                worktreeId: worktree.id,
              }),
            ])
          }
          if (record !== undefined && workspace?.isGitRepo) {
            const at = yield* Clock.currentTimeMillis
            const session = yield* checkpointSession(record, forkedTurns(model), at)
            yield* pruneArchivedSession(workspace.path, session, { policy: checkpointPolicy }).pipe(
              Effect.catch((error) =>
                Effect.logWarning(`checkpoint prune of ${command.sessionId}: ${error.message}`),
              ),
            )
          }
          yield* attachmentStore.onSessionArchived(command.sessionId)
        })

      case "OpenInTerminal":
        return Effect.gen(function* () {
          yield* cancelIdle(command.sessionId)
          const entry = yield* openHarness(command.sessionId)
          const argv = yield* entry.session.terminalCommand
          const cwd = (yield* store.model).sessions.get(command.sessionId)?.session.cwd ?? ""
          terminalLaunch.set(
            command.sessionId,
            new TerminalLaunch({ argv: [...argv], cwd, env: {} }),
          )
          // Claude hands off sequentially; Codex's TUI co-attaches to the running app-server.
          if (!entry.driver.capabilities.liveCoAttach) {
            yield* stopHarness(command.sessionId)
            yield* startFollower(command.sessionId, entry.driver)
          }
        }).pipe(Effect.catch((error) => failSession(command.sessionId, messageOf(error))))

      case "ReturnFromTerminal":
        return Effect.gen(function* () {
          terminalLaunch.delete(command.sessionId)
          // Drain what the terminal UI did, including the cursor it ended on, before resuming.
          yield* stopFollower(command.sessionId, true)
          const record = (yield* store.model).sessions.get(command.sessionId)
          const driver = record === undefined ? null : yield* registry.get(record.session.harness)
          if (driver !== null && !driver.capabilities.liveCoAttach) {
            // Polaris sent no Turn while In Terminal, so one still open is the terminal UI's,
            // left unfinished when it closed.
            yield* signal(command.sessionId, { type: "terminal.closed", at: yield* now })
          }
          yield* openHarness(command.sessionId)
          yield* signal(command.sessionId, { type: "harness.resumed" })
        }).pipe(Effect.catch((error) => failSession(command.sessionId, messageOf(error))))

      case "ForkSession":
        return Effect.gen(function* () {
          const record = result.model.sessions.get(command.sessionId)
          const worktreeId = record?.session.worktreeId ?? null
          // No Worktree of its own (not a git repo, or no checkpoint): it shares the parent's cwd.
          if (record === undefined || worktreeId === null || result.model.worktrees.has(worktreeId))
            return
          const workspace = result.model.workspaces.get(record.session.workspaceId)
          const turn = yield* findTurn(command.fromSessionId, command.fromTurnId)
          if (workspace === undefined || turn?.checkpointAfter == null) return
          yield* createWorktree(command.sessionId, workspace, {
            path: record.session.cwd,
            branch: forkBranch(command.sessionId),
            baseRef: turn.checkpointAfter,
          })
        })

      case "UnarchiveSession":
        return Effect.gen(function* () {
          // Archive removed the Worktree the session created and kept its branch: bring it back.
          const model = yield* store.model
          const record = model.sessions.get(command.sessionId)
          const worktreeId = record?.session.worktreeId ?? null
          if (record === undefined || worktreeId === null || model.worktrees.has(worktreeId)) return
          const workspace = model.workspaces.get(record.session.workspaceId)
          const known = yield* store.lastKnownWorktree(worktreeId)
          if (
            workspace === undefined ||
            known === null ||
            known.isMain ||
            known.branch === null ||
            known.createdBySessionId !== command.sessionId
          )
            return
          yield* createWorktree(command.sessionId, workspace, {
            path: known.path,
            branch: known.branch,
            baseRef: null,
          })
        })

      case "RemoveWorkspace":
        return Effect.gen(function* () {
          // Nothing will sweep this repository any more: its sessions' checkpoints go now.
          const workspace = before.workspaces.get(command.workspaceId)
          if (workspace === undefined || !workspace.isGitRepo) return
          const sessionIds = [...result.model.sessions.values()]
            .filter((record) => record.session.workspaceId === workspace.id)
            .map((record) => record.session.id)
          yield* Effect.forEach(
            sessionIds,
            (sessionId) =>
              Effect.tryPromise({
                try: () => dropSessionCheckpoints(workspace.path, sessionId),
                catch: messageOf,
              }).pipe(
                Effect.catch((message) =>
                  Effect.logWarning(`dropping checkpoints of ${sessionId}: ${message}`),
                ),
              ),
            { discard: true },
          )
        })

      case "SetWorkspaceHidden":
      case "RenameSession":
        return Effect.void
    }
  }

  /**
   * Create a Worktree for a session and record it; on failure the session goes Failed.
   * An existing `branch` is checked out as is; otherwise it is created at `baseRef`.
   */
  const createWorktree = (
    sessionId: SessionId,
    workspace: Workspace,
    options: { readonly path: string; readonly branch: string; readonly baseRef: string | null },
  ) =>
    Effect.gen(function* () {
      const created = yield* worktrees
        .create({ repoPath: workspace.path, ...options })
        .pipe(
          Effect.catch((error) =>
            failSession(sessionId, `could not create the Worktree: ${error.message}`).pipe(
              Effect.as(null),
            ),
          ),
        )
      if (created === null) return false
      yield* recordFor(sessionId, () => [
        DomainEvent.cases.WorktreeDetected.make({
          worktree: new Worktree({
            id: worktreeIdFor(options.path),
            workspaceId: workspace.id,
            path: options.path,
            branch: created.branch,
            head: created.head,
            createdBySessionId: sessionId,
            isMain: false,
          }),
        }),
      ])
      return true
    })

  /** A Turn of any age: recent ones are in memory, older ones in SQL. */
  const findTurn = (sessionId: SessionId, turnId: TurnId) =>
    Effect.gen(function* () {
      const record = (yield* store.model).sessions.get(sessionId)
      const recent = record?.turns.find((t) => t.id === turnId)
      if (recent !== undefined || record === undefined) return recent ?? null
      const older = yield* store.readTurns({
        sessionId,
        beforeIndex: record.turns[0]?.index ?? null,
        limit: null,
      })
      return older.find((t) => t.id === turnId) ?? null
    })

  // ── Checkpoint pruning (git/prune.ts) ────────────────────────────────────

  const checkpointPolicy = config.checkpointPolicy ?? DEFAULT_CHECKPOINT_POLICY

  /** The Turns each session's Forks started from, which survive compaction. */
  const forkedTurns = (model: ReadModel): ReadonlyMap<SessionId, ReadonlyArray<TurnId>> => {
    const pinned = new Map<SessionId, Array<TurnId>>()
    for (const { session } of model.sessions.values()) {
      if (session.parentSessionId === null || session.forkedFromTurnId === null) continue
      const list = pinned.get(session.parentSessionId) ?? []
      list.push(session.forkedFromTurnId)
      pinned.set(session.parentSessionId, list)
    }
    return pinned
  }

  /**
   * What the pruning policy knows about one session. A session that is not
   * Archived keeps every checkpoint, so only an Archived one needs its Turn
   * order and its Worktree's branch (both read from SQL).
   */
  const checkpointSession = (
    record: SessionRecord,
    pinned: ReadonlyMap<SessionId, ReadonlyArray<TurnId>>,
    archivedAt: number | null,
  ): Effect.Effect<CheckpointSession, ServiceError> =>
    Effect.gen(function* () {
      const session = record.session
      const base = {
        sessionId: session.id,
        archivedAt,
        pinnedTurnIds: pinned.get(session.id) ?? [],
      }
      if (archivedAt === null) return base
      const stored = yield* store.readTurns({
        sessionId: session.id,
        beforeIndex: null,
        limit: null,
      })
      const turns = new Map([...stored, ...record.turns].map((turn) => [turn.id, turn]))
      const worktree =
        session.worktreeId === null ? null : yield* store.lastKnownWorktree(session.worktreeId)
      return {
        ...base,
        turnIds: [...turns.values()].sort((a, b) => a.index - b.index).map((turn) => turn.id),
        worktreeBranch:
          worktree !== null && !worktree.isMain && worktree.createdBySessionId === session.id
            ? worktree.branch
            : null,
      }
    })

  /**
   * Every git Workspace with all its sessions, built fresh for each sweep. An
   * Archived session's `updatedAt` stands in for when it was Archived: a later
   * change (a rename) only postpones its pruning.
   */
  const checkpointTargets = Effect.gen(function* () {
    const model = yield* store.model
    const pinned = forkedTurns(model)
    const targets: Array<SweepTarget> = []
    for (const workspace of model.workspaces.values()) {
      if (!workspace.isGitRepo) continue
      const sessions = yield* Effect.forEach(
        [...model.sessions.values()].filter((r) => r.session.workspaceId === workspace.id),
        (record) =>
          checkpointSession(
            record,
            pinned,
            record.session.state === "archived" ? Date.parse(record.session.updatedAt) : null,
          ),
      )
      targets.push({ repoPath: workspace.path, sessions })
    }
    return targets
  })

  // ── Terminal hand-off ────────────────────────────────────────────────────

  /** Follow a sequentially handed-off session's terminal UI (e.g. Claude's hooks). */
  const startFollower = (sessionId: SessionId, driver: HarnessDriver) =>
    Effect.gen(function* () {
      const follow = driver.terminalFollow
      if (follow === undefined || followers.has(sessionId)) return
      const follower: TerminalFollower = {
        driver,
        scope: yield* Scope.make(),
        stopping: false,
        fiber: null,
      }
      followers.set(sessionId, follower)
      follower.fiber = yield* Effect.forkIn(
        follow
          .events(sessionId)
          .pipe(
            Stream.runForEach((event) =>
              onHarnessEvent(sessionId, follower, event).pipe(
                Effect.catchCause((cause) =>
                  Effect.logError(`following ${event._tag} for ${sessionId} failed`, cause),
                ),
              ),
            ),
          ),
        engineScope,
      )
    })

  /** Stop following; with `drain`, first handle what the terminal UI already reported. */
  const stopFollower = (sessionId: SessionId, drain: boolean) =>
    Effect.gen(function* () {
      const follower = followers.get(sessionId)
      if (follower === undefined) return
      followers.delete(sessionId)
      yield* follower.driver.terminalFollow?.release(sessionId) ?? Effect.void
      if (follower.fiber !== null) {
        if (drain) {
          yield* Fiber.join(follower.fiber).pipe(Effect.timeout(FOLLOWER_DRAIN), Effect.ignore)
        }
        yield* Fiber.interrupt(follower.fiber)
      }
      follower.stopping = true
      yield* Scope.close(follower.scope, Exit.void)
    })

  const respond = (
    sessionId: SessionId,
    requestId: ApprovalRequest["id"],
    decision: ApprovalDecision,
  ) =>
    Effect.gen(function* () {
      const entry = live.get(sessionId)
      if (entry === undefined) {
        return yield* Effect.logWarning(
          `no running Harness for ${sessionId} to answer ${requestId}`,
        )
      }
      yield* entry.session.respond(requestId, decision)
    })

  const sessionOfCommand = (command: Command): SessionId | null =>
    "sessionId" in command ? command.sessionId : null

  // ── Dispatch ─────────────────────────────────────────────────────────────

  const resolveAttachments = (commandId: CommandId, command: Command) =>
    Effect.gen(function* () {
      if (command._tag !== "StartSession" && command._tag !== "SendTurn") return []
      if (command.attachments.length === 0) return []
      const found = yield* attachmentStore
        .get(command.attachments)
        .pipe(
          Effect.mapError(
            (error) => new CommandRejected({ commandId, reason: `attachments: ${error.message}` }),
          ),
        )
      const missing = command.attachments.filter((id) => !found.some((a) => a.id === id))
      if (missing.length > 0) {
        return yield* new CommandRejected({
          commandId,
          reason: `unknown attachments: ${missing.join(", ")}`,
        })
      }
      return command.attachments.map((id) => found.find((a) => a.id === id)!)
    })

  const canSteer = (command: Command) =>
    Effect.gen(function* () {
      if (command._tag !== "Steer") return false
      const model = yield* store.model
      const record = model.sessions.get(command.sessionId)
      if (record === undefined) return false
      const driver = yield* registry.get(record.session.harness).pipe(Effect.option)
      return driver._tag === "Some" && driver.value.capabilities.steer
    })

  const dispatch = Effect.fn("Engine.dispatch")(function* (options: {
    readonly commandId: CommandId
    readonly command: Command
    readonly deviceLabel: string
  }) {
    const { commandId, command } = options
    const ctx = {
      commandId,
      now: yield* now,
      deviceLabel: options.deviceLabel,
      newTurnId: TurnId.make(`turn_${crypto.randomUUID()}`),
      newWorkspaceId: WorkspaceId.make(`ws_${crypto.randomUUID()}`),
      attachments: yield* resolveAttachments(commandId, command),
      pathProbe: command._tag === "RegisterWorkspace" ? probePath(command.path) : null,
      canSteer: yield* canSteer(command),
      forkTurn:
        command._tag === "ForkSession"
          ? yield* findTurn(command.fromSessionId, command.fromTurnId).pipe(Effect.orDie)
          : null,
    }
    let before: ReadModel | null = null
    const result = yield* store
      .commit({
        commandId,
        decide: (model) => {
          before = model
          return decide(model, command, ctx)
        },
      })
      .pipe(Effect.catchTag("ServiceError", (error) => Effect.die(error)))
    if (result._tag === "Committed") {
      const sessionId = sessionOfCommand(command)
      const reaction = react(command, result, before ?? result.model).pipe(
        Effect.catchCause((cause) => Effect.logError(`reacting to ${command._tag} failed`, cause)),
      )
      yield* Effect.forkIn(
        sessionId === null ? reaction : serially(sessionId)(reaction),
        engineScope,
      )
    }
    return { sequence: result.sequence }
  })

  // ── Streams ──────────────────────────────────────────────────────────────

  const summaryOf = (record: SessionRecord) =>
    new SessionSummary({
      session: record.session,
      pendingApprovals: [...record.pending.values()],
      lastTurnPreview: lastTurn(record)?.prompt.slice(0, 140) ?? null,
    })

  const subscribeHost = (afterSequence: Sequence | null): Stream.Stream<HostStreamItem> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* store.subscribe({
          filter: (item) => item._tag === "Event" && isHostStreamEvent(item.envelope.event),
        })
        const model = yield* store.model
        const cut = model.sequence as Sequence
        const head: Array<HostStreamItem> = []
        if (afterSequence === null || afterSequence > cut) {
          head.push({
            _tag: "Snapshot",
            sequence: cut,
            workspaces: [...model.workspaces.values()],
            worktrees: [...model.worktrees.values()],
            sessions: [...model.sessions.values()].map(summaryOf),
          })
        } else {
          const events = yield* store.readEvents({
            after: afterSequence,
            upTo: cut,
            sessionId: null,
          })
          for (const envelope of events) head.push({ _tag: "Event", envelope })
        }
        head.push({ _tag: "Synchronized", sequence: cut })
        const liveItems = subscription.pipe(
          Stream.filterMap((item) =>
            item._tag === "Event" && item.envelope.sequence > cut
              ? Result.succeed<HostStreamItem>({ _tag: "Event", envelope: item.envelope })
              : Result.failVoid,
          ),
        )
        return Stream.concat(Stream.fromIterable(head), liveItems)
      }).pipe(Effect.orDie),
    )

  const subscribeSession = (options: {
    readonly sessionId: SessionId
    readonly afterSequence: Sequence | null
    readonly turnLimit: number | null
    readonly liveItems?: boolean
  }): Stream.Stream<SessionStreamItem, NotFound> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { sessionId, afterSequence } = options
        const withProgress = options.liveItems === true
        const subscription = yield* store.subscribe({
          sessionId,
          ...(withProgress ? {} : { filter: (item: LiveItem) => item._tag !== "ItemProgress" }),
        })
        const model = yield* store.model
        const record = model.sessions.get(sessionId)
        if (record === undefined) {
          return yield* Effect.fail(new NotFound({ what: "session", id: sessionId }))
        }
        const cut = model.sequence as Sequence
        const head: Array<SessionStreamItem> = []
        if (afterSequence === null || afterSequence > cut) {
          // Recent Turns come from the model (consistent with the cut); older, finished
          // ones from SQL.
          const total = record.session.turnCount
          const wanted = options.turnLimit === null ? total : Math.min(options.turnLimit, total)
          const recent = record.turns.slice(Math.max(0, record.turns.length - wanted))
          const older =
            wanted > recent.length
              ? yield* store
                  .readTurns({
                    sessionId,
                    beforeIndex: recent[0]?.index ?? total,
                    limit: wanted - recent.length,
                  })
                  .pipe(Effect.orDie)
              : []
          const turns = [...older, ...recent]
          const items = yield* store
            .readTurnItems({ turnIds: turns.map((t) => t.id), upTo: cut })
            .pipe(Effect.orDie)
          head.push({
            _tag: "Snapshot",
            sequence: cut,
            session: record.session,
            turns: turns.map(
              (turn) =>
                new TurnDetail({ turn, items: [...(items.get(turn.id) ?? ([] as TurnItem[]))] }),
            ),
            pendingApprovals: [...record.pending.values()],
          })
        } else {
          const events = yield* store
            .readEvents({ after: afterSequence, upTo: cut, sessionId })
            .pipe(Effect.orDie)
          for (const envelope of events) head.push({ _tag: "Event", envelope })
        }
        head.push({ _tag: "Synchronized", sequence: cut })
        // Items still running, so a Client that subscribes mid-Turn sees them at once.
        if (withProgress) {
          for (const { turnId, item } of progress.get(sessionId)?.values() ?? []) {
            head.push({ _tag: "ItemProgress", turnId, item })
          }
        }
        // One stage rather than a filter and a map: this runs for every Delta.
        const liveItems = subscription.pipe(
          Stream.filterMap((item): Result.Result<SessionStreamItem, void> => {
            if (item._tag === "Event") {
              return item.envelope.sequence > cut
                ? Result.succeed({ _tag: "Event", envelope: item.envelope })
                : Result.failVoid
            }
            const { sessionId: _, ...ephemeral } = item
            return Result.succeed(ephemeral)
          }),
        )
        return Stream.concat(Stream.fromIterable(head), liveItems)
      }),
    )

  // ── Recovery after a Daemon restart ──────────────────────────────────────

  // The recovery rule is the session machine's `daemon.recover` (session.ts): a Turn in
  // flight ends Interrupted and the session Needs You; it is never continued automatically.
  yield* Effect.gen(function* () {
    const model = yield* store.model
    const at = yield* now
    for (const record of model.sessions.values()) {
      const input: SessionInput = { type: "daemon.recover", cause: "restart", at }
      // Most sessions (Dormant, Archived) have nothing to recover: skip their commit.
      if (decideSession(record, input).events.length === 0) continue
      yield* signal(record.session.id, input)
    }
  }).pipe(Effect.orDie)

  const prepareForUpgrade = Effect.gen(function* () {
    const inProcess = [...live.entries()]
      .filter(([, entry]) => !entry.driver.capabilities.liveCoAttach)
      .map(([id]) => id)
    yield* Effect.forEach(
      inProcess,
      (sessionId) =>
        serially(sessionId)(
          Effect.gen(function* () {
            yield* cancelIdle(sessionId)
            yield* stopHarness(sessionId)
            yield* signal(sessionId, { type: "daemon.recover", cause: "upgrade", at: yield* now })
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`preparing ${sessionId} for the upgrade failed`, cause),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
  }).pipe(Effect.withSpan("Engine.prepareForUpgrade"))

  // Runs whenever this Daemon execs into a new binary, for as long as the engine lives.
  // If the exec fails, the sessions it stopped stay Dormant or Needs You and resume on
  // their next Turn, as after a restart, so there is nothing to undo.
  yield* registerHandoffContributor({
    name: "engine",
    collect: () => Effect.succeed({ fds: {}, children: {} }),
    beforeExec: prepareForUpgrade,
  })

  if (config.checkpointSweepInterval !== null) {
    yield* Effect.forkIn(
      runCheckpointSweeper({
        targets: checkpointTargets,
        policy: checkpointPolicy,
        ...(config.checkpointSweepInterval === undefined
          ? {}
          : { interval: config.checkpointSweepInterval }),
      }),
      engineScope,
    )
  }

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...live.keys()], (id) => stopHarness(id), { discard: true }),
  )

  return Engine.of({
    dispatch,
    subscribeHost,
    subscribeSession,
    hasSession: (sessionId) => Effect.map(store.model, (model) => model.sessions.has(sessionId)),
    terminalCommand: (sessionId) => Effect.sync(() => terminalLaunch.get(sessionId) ?? null),
    prepareForUpgrade,
  })
})

// ── Helpers ─────────────────────────────────────────────────────────────────

const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : String(error)

const probePath = (path: string) => {
  try {
    if (!statSync(path).isDirectory()) return { isDirectory: false, isGitRepo: false }
    let isGitRepo = false
    try {
      statSync(join(path, ".git"))
      isGitRepo = true
    } catch {}
    return { isDirectory: true, isGitRepo }
  } catch {
    return null
  }
}
