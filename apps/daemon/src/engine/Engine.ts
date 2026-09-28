/**
 * The orchestration engine: decides commands, records them, and supervises
 * each Agent Session's Harness.
 *
 *   dispatch ─▶ decide (under the commit lock) ─▶ commit ─▶ ack
 *                                                  └─▶ reactor (after commit, per-session serial)
 *   Harness events ─▶ mapped to domain events ─▶ commit
 *
 * An ack means the intent is recorded; the reactor opens Harnesses, captures
 * checkpoints, creates or removes Worktrees and so on. Nothing here writes
 * to the database except through `EventStore.commit`.
 */
import { statSync } from "node:fs"
import { join } from "node:path"
import {
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
  Turn,
  TurnDetail,
  TurnId,
  type TurnItem,
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
  Scope,
  Semaphore,
  Stream,
} from "effect"
import type { HarnessDriver, HarnessEvent, HarnessSession } from "../harness/HarnessDriver.ts"
import {
  AttachmentStore,
  Checkpoints,
  HarnessRegistry,
  type ServiceError,
  WorktreeTracker,
} from "../services.ts"
import { type CommitResult, EventStore } from "../store/EventStore.ts"
import {
  isHostStreamEvent,
  lastTurn,
  type ReadModel,
  type SessionRecord,
  workingTurn,
} from "../store/model.ts"
import { CONTINUE_PROMPT, decide, stateChanged, worktreeIdFor } from "./decider.ts"

export interface EngineSettings {
  /** How long an Idle session keeps its Harness process before going Dormant. */
  readonly idleTimeout: Duration.Input
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
    }) => Stream.Stream<SessionStreamItem, NotFound>
    /** argv of the Harness's own TUI for a session handed to the terminal, once known. */
    readonly terminalCommand: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<string> | null>
  }
>()("polaris/daemon/engine/Engine") {
  static readonly layer = Layer.effect(
    Engine,
    Effect.suspend(() => make),
  )
}

interface LiveHarness {
  readonly driver: HarnessDriver
  readonly session: HarnessSession
  readonly scope: Scope.Closeable
  consumer: Fiber.Fiber<void> | null
  /** Set when Polaris stops the Harness on purpose, so its exit is not treated as a crash. */
  stopping: boolean
}

const HARNESS = "Harness"
const DAEMON = "Daemon"

const make = Effect.gen(function* () {
  const store = yield* EventStore
  const registry = yield* HarnessRegistry
  const checkpoints = yield* Checkpoints
  const worktrees = yield* WorktreeTracker
  const attachmentStore = yield* AttachmentStore
  const config = yield* EngineConfig
  const engineScope = yield* Effect.scope

  const live = new Map<SessionId, LiveHarness>()
  const terminalArgv = new Map<SessionId, ReadonlyArray<string>>()
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

  const committedAny = (result: CommitResult) =>
    result._tag === "Committed" && result.envelopes.length > 0

  const withdrawPending = (
    record: SessionRecord,
    resolvedBy: string,
    reason: string,
    onlyTurn?: TurnId,
  ): Array<DomainEvent> =>
    [...record.pending.values()]
      .filter((request) => onlyTurn === undefined || request.turnId === onlyTurn)
      .map((request) =>
        DomainEvent.cases.ApprovalResolved.make({
          sessionId: record.session.id,
          requestId: request.id,
          decision: { _tag: "Deny", reason },
          resolvedBy,
        }),
      )

  const endTurn = (
    turn: Turn,
    status: "completed" | "interrupted" | "failed",
    endedAt: string,
    checkpointAfter: string | null = turn.checkpointAfter,
  ): DomainEvent =>
    DomainEvent.cases.TurnEnded.make({
      turn: new Turn({ ...turn, status, endedAt, checkpointAfter }),
    })

  /** The Turn in flight fails and the session goes Failed. */
  const failSession = (sessionId: SessionId, message: string) =>
    Effect.gen(function* () {
      const at = yield* now
      yield* Effect.logWarning(`session ${sessionId} failed: ${message}`)
      yield* recordFor(sessionId, (record) => {
        const turn = workingTurn(record)
        return [
          ...(turn ? [endTurn(turn, "failed", at)] : []),
          ...withdrawPending(record, DAEMON, message),
          stateChanged(sessionId, "failed", message),
        ]
      })
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
      if (entry.consumer !== null) yield* Fiber.interrupt(entry.consumer)
      yield* Scope.close(entry.scope, Exit.void)
    })

  const goDormant = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const result = yield* recordFor(sessionId, (record) =>
        record.session.state === "idle" && live.has(sessionId)
          ? [stateChanged(sessionId, "dormant", "idle-timeout")]
          : [],
      )
      if (committedAny(result)) yield* stopHarness(sessionId)
    }).pipe(Effect.catchCause((cause) => Effect.logError("idle stop failed", cause)))

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

  const onHarnessEvent = (sessionId: SessionId, entry: LiveHarness, event: HarnessEvent) =>
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
          yield* recordFor(sessionId, (record) => {
            if (record.turns.some((t) => t.id === event.turnId)) return []
            const turn = new Turn({
              id: event.turnId,
              sessionId,
              index: record.turns.length,
              prompt: "",
              attachments: [],
              status: "working",
              checkpointBefore: null,
              checkpointAfter: null,
              startedAt: at,
              endedAt: null,
            })
            const state = record.session.state
            return [
              DomainEvent.cases.TurnStarted.make({ turn }),
              ...(state === "idle" || state === "starting" || state === "dormant"
                ? [stateChanged(sessionId, "working")]
                : []),
            ]
          })
          yield* cancelIdle(sessionId)
          return
        case "ItemDelta":
          yield* store.publishDelta({
            _tag: "Delta",
            sessionId,
            turnId: event.turnId,
            itemId: event.itemId,
            field: event.field,
            text: event.text,
          })
          return
        case "ItemCompleted":
          yield* recordFor(sessionId, () => [
            DomainEvent.cases.TurnItemCompleted.make({
              sessionId,
              turnId: event.turnId,
              item: event.item,
            }),
          ])
          return
        case "ApprovalRequested":
          yield* recordFor(sessionId, (record) => {
            const request = new ApprovalRequest({
              id: event.requestId,
              sessionId,
              turnId: event.turnId,
              kind: event.kind,
              title: event.title,
              detail: event.detail,
              options: [...event.options],
              openedAt: at,
            })
            const state = record.session.state
            return [
              DomainEvent.cases.ApprovalRequested.make({ request }),
              ...(state === "in-terminal" || state === "needs-you"
                ? []
                : [stateChanged(sessionId, "needs-you")]),
            ]
          })
          return
        case "ApprovalWithdrawn":
          yield* recordFor(sessionId, (record) => {
            if (!record.pending.has(event.requestId)) return []
            return [
              DomainEvent.cases.ApprovalResolved.make({
                sessionId,
                requestId: event.requestId,
                decision: { _tag: "Deny", reason: "Withdrawn by the Harness" },
                resolvedBy: HARNESS,
              }),
              ...(record.pending.size === 1 && record.session.state === "needs-you"
                ? [stateChanged(sessionId, "working")]
                : []),
            ]
          })
          return
        case "TurnEnded": {
          const after = yield* capture(sessionId, event.turnId, "after")
          const result = yield* recordFor(sessionId, (record) => {
            const turn = record.turns.find((t) => t.id === event.turnId)
            if (turn === undefined || turn.status !== "working") return []
            const events: Array<DomainEvent> = []
            if (after !== null) {
              events.push(
                DomainEvent.cases.CheckpointRecorded.make({
                  sessionId,
                  turnId: turn.id,
                  ref: after.ref,
                  commit: after.commit,
                }),
              )
            }
            events.push(
              ...withdrawPending(record, HARNESS, "The Turn ended", turn.id),
              endTurn(turn, event.status, at, after?.ref ?? turn.checkpointAfter),
            )
            if (record.session.state !== "in-terminal") {
              events.push(
                event.status === "failed"
                  ? stateChanged(sessionId, "failed", event.error ?? "The Turn failed")
                  : stateChanged(sessionId, "idle"),
              )
            }
            return events
          })
          const model = yield* store.model
          if (committedAny(result) && model.sessions.get(sessionId)?.session.state === "idle") {
            yield* scheduleIdle(sessionId)
          }
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
          yield* cancelIdle(sessionId)
          yield* Scope.close(entry.scope, Exit.void)
          yield* recordFor(sessionId, (record) => {
            const state = record.session.state
            if (state === "archived" || state === "dormant") return []
            const turn = workingTurn(record)
            const reason = event.error ?? "The Harness exited"
            const events: Array<DomainEvent> = [
              ...(turn ? [endTurn(turn, event.error ? "failed" : "interrupted", at)] : []),
              ...withdrawPending(record, HARNESS, reason),
            ]
            if (state === "in-terminal") return events
            events.push(
              event.error !== null
                ? stateChanged(sessionId, "failed", event.error)
                : stateChanged(sessionId, "dormant", "harness-exited"),
            )
            return events
          })
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
      const entry = yield* openHarness(sessionId)
      yield* recordFor(sessionId, (record) =>
        record.session.state === "starting" ? [stateChanged(sessionId, "working")] : [],
      )
      yield* entry.session.sendTurn({ turnId, prompt, attachments })
    }).pipe(Effect.catch((error) => failSession(sessionId, messageOf(error))))

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
            const created = yield* worktrees
              .create({
                repoPath: workspace.path,
                path: record.session.cwd,
                branch: command.placement.branch.trim(),
                baseRef: command.placement.baseRef,
              })
              .pipe(
                Effect.catch((error) =>
                  failSession(
                    command.sessionId,
                    `could not create the Worktree: ${error.message}`,
                  ).pipe(Effect.as(null)),
                ),
              )
            if (created === null) return
            yield* recordFor(command.sessionId, () => [
              DomainEvent.cases.WorktreeDetected.make({
                worktree: new Worktree({
                  id: worktreeIdFor(record.session.cwd),
                  workspaceId: workspace.id,
                  path: record.session.cwd,
                  branch: created.branch,
                  head: created.head,
                  createdBySessionId: command.sessionId,
                  isMain: false,
                }),
              }),
            ])
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
          const at = yield* now
          yield* recordFor(command.sessionId, (record) => {
            const turn = workingTurn(record)
            if (turn === undefined) return []
            return [
              ...withdrawPending(record, DAEMON, "Interrupted"),
              endTurn(turn, "interrupted", at),
              stateChanged(command.sessionId, "dormant"),
            ]
          })
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
          terminalArgv.delete(command.sessionId)
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
          yield* attachmentStore.onSessionArchived(command.sessionId)
        })

      case "OpenInTerminal":
        return Effect.gen(function* () {
          yield* cancelIdle(command.sessionId)
          const entry = yield* openHarness(command.sessionId)
          terminalArgv.set(command.sessionId, yield* entry.session.terminalCommand)
          // Claude hands off sequentially; Codex's TUI co-attaches to the running app-server.
          if (!entry.driver.capabilities.liveCoAttach) yield* stopHarness(command.sessionId)
        }).pipe(Effect.catch((error) => failSession(command.sessionId, messageOf(error))))

      case "ReturnFromTerminal":
        return Effect.gen(function* () {
          terminalArgv.delete(command.sessionId)
          yield* openHarness(command.sessionId)
          yield* recordFor(command.sessionId, (record) =>
            record.session.state !== "starting"
              ? []
              : [stateChanged(command.sessionId, workingTurn(record) ? "working" : "idle")],
          )
          const model = yield* store.model
          if (model.sessions.get(command.sessionId)?.session.state === "idle") {
            yield* scheduleIdle(command.sessionId)
          }
        }).pipe(Effect.catch((error) => failSession(command.sessionId, messageOf(error))))

      case "SetWorkspaceHidden":
      case "RemoveWorkspace":
      case "RenameSession":
      case "ForkSession":
      case "UnarchiveSession":
        return Effect.void
    }
  }

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
    }
    const result = yield* store
      .commit({ commandId, decide: (model) => decide(model, command, ctx) })
      .pipe(Effect.catchTag("ServiceError", (error) => Effect.die(error)))
    if (result._tag === "Committed") {
      const sessionId = sessionOfCommand(command)
      const reaction = react(command, result).pipe(
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
        const subscription = yield* store.subscribe
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
        const liveItems = Stream.fromSubscription(subscription).pipe(
          Stream.filter(
            (item) =>
              item._tag === "Event" &&
              item.envelope.sequence > cut &&
              isHostStreamEvent(item.envelope.event),
          ),
          Stream.map(
            (item): HostStreamItem => ({
              _tag: "Event",
              envelope: (item as Extract<typeof item, { _tag: "Event" }>).envelope,
            }),
          ),
        )
        return Stream.concat(Stream.fromIterable(head), liveItems)
      }).pipe(Effect.orDie),
    )

  const subscribeSession = (options: {
    readonly sessionId: SessionId
    readonly afterSequence: Sequence | null
    readonly turnLimit: number | null
  }): Stream.Stream<SessionStreamItem, NotFound> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { sessionId, afterSequence } = options
        const subscription = yield* store.subscribe
        const model = yield* store.model
        const record = model.sessions.get(sessionId)
        if (record === undefined) {
          return yield* Effect.fail(new NotFound({ what: "session", id: sessionId }))
        }
        const cut = model.sequence as Sequence
        const head: Array<SessionStreamItem> = []
        if (afterSequence === null || afterSequence > cut) {
          const limit = options.turnLimit
          const turns =
            limit === null
              ? record.turns
              : record.turns.slice(Math.max(0, record.turns.length - limit))
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
        const liveItems = Stream.fromSubscription(subscription).pipe(
          Stream.filter((item) =>
            item._tag === "Event"
              ? item.sessionId === sessionId && item.envelope.sequence > cut
              : item.sessionId === sessionId,
          ),
          Stream.map((item): SessionStreamItem => {
            if (item._tag === "Event") return { _tag: "Event", envelope: item.envelope }
            const { sessionId: _, ...delta } = item
            return delta
          }),
        )
        return Stream.concat(Stream.fromIterable(head), liveItems)
      }),
    )

  // ── Recovery after a Daemon restart ──────────────────────────────────────

  yield* Effect.gen(function* () {
    const model = yield* store.model
    const at = yield* now
    for (const record of model.sessions.values()) {
      const state = record.session.state
      if (state === "archived" || state === "dormant") continue
      yield* recordFor(record.session.id, (current) => {
        const turn = workingTurn(current)
        const events: Array<DomainEvent> = [
          ...(turn ? [endTurn(turn, "interrupted", at)] : []),
          ...withdrawPending(current, DAEMON, "The Daemon restarted"),
        ]
        const id = current.session.id
        if (turn !== undefined) {
          // Never continue automatically: the user decides, with Continue.
          events.push(stateChanged(id, "needs-you", "interrupted"))
        } else if (current.session.state === "failed") {
          // Failed stays Failed until the user sends a Turn.
        } else if (
          current.session.state === "needs-you" &&
          lastTurn(current)?.status === "interrupted"
        ) {
          // Still waiting on Continue from before.
        } else {
          events.push(stateChanged(id, "dormant", "daemon-restart"))
        }
        return events
      })
    }
  }).pipe(Effect.orDie)

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...live.keys()], (id) => stopHarness(id), { discard: true }),
  )

  return Engine.of({
    dispatch,
    subscribeHost,
    subscribeSession,
    terminalCommand: (sessionId) => Effect.sync(() => terminalArgv.get(sessionId) ?? null),
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
