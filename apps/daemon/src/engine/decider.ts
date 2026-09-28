/**
 * The decider: validates a Client command against the current read model and
 * returns the events that record its intent. It is pure; everything it needs
 * from the outside world (ids, the clock, resolved attachments, a filesystem
 * probe) arrives in `DecideContext`. Side effects happen after commit, in the
 * reactors (`Engine.ts`).
 */
import { basename, join } from "node:path"
import {
  AgentSession,
  type Attachment,
  type Command,
  type CommandId,
  CommandRejected,
  DomainEvent,
  NotFound,
  type SessionId,
  type SessionState,
  Turn,
  type TurnId,
  Workspace,
  type WorkspaceId,
  WorktreeId,
} from "@polaris/protocol"
import { Effect } from "effect"
import { lastTurn, type ReadModel, type SessionRecord, workingTurn } from "../store/model.ts"

export interface DecideContext {
  readonly commandId: CommandId
  readonly now: string
  /** Label of the Client device that sent the command (for `ApprovalResolved.resolvedBy`). */
  readonly deviceLabel: string
  /** Fresh ids, used only by the commands that create something. */
  readonly newTurnId: TurnId
  readonly newWorkspaceId: WorkspaceId
  /** Attachments of StartSession / SendTurn, resolved from the AttachmentStore. */
  readonly attachments: ReadonlyArray<Attachment>
  /** For RegisterWorkspace: what is at `path`. */
  readonly pathProbe: { readonly isDirectory: boolean; readonly isGitRepo: boolean } | null
  /** For Steer: whether the session's Harness supports it. */
  readonly canSteer: boolean
}

type Decision = Effect.Effect<ReadonlyArray<DomainEvent>, CommandRejected | NotFound>

/** Worktree ids are derived from the path, so every observer of a path agrees on its id. */
export const worktreeIdFor = (path: string): WorktreeId =>
  WorktreeId.make(`wt_${Bun.hash(path).toString(16)}`)

export const titleFromPrompt = (prompt: string): string => {
  const line = prompt.trim().split("\n")[0]?.trim() ?? ""
  if (line === "") return "New session"
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

/** What the engine sends the Harness when the user continues an Interrupted Turn. */
export const CONTINUE_PROMPT = "Continue from where you left off."

export const stateChanged = (
  sessionId: SessionId,
  state: SessionState,
  reason: string | null = null,
): DomainEvent => DomainEvent.cases.SessionStateChanged.make({ sessionId, state, reason })

/** Session States in which the Harness process is known to be running. */
const liveStates: ReadonlyArray<SessionState> = ["idle", "working", "needs-you"]

/** Session States that accept a new Turn. */
const acceptsTurn = (record: SessionRecord): boolean => {
  const { state } = record.session
  if (workingTurn(record) !== undefined) return false
  if (state === "idle" || state === "dormant" || state === "failed") return true
  // Needs You after a Daemon restart (an Interrupted Turn, nothing pending) takes a new Turn too.
  return state === "needs-you" && record.pending.size === 0
}

export const decide = (model: ReadModel, command: Command, ctx: DecideContext): Decision => {
  const reject = (reason: string) =>
    Effect.fail(new CommandRejected({ commandId: ctx.commandId, reason }))
  const notFound = (what: string, id: string) => Effect.fail(new NotFound({ what, id }))
  const ok = (...events: ReadonlyArray<DomainEvent>): Decision => Effect.succeed(events)

  const withSession = (sessionId: SessionId, f: (record: SessionRecord) => Decision): Decision => {
    const record = model.sessions.get(sessionId)
    return record === undefined ? notFound("session", sessionId) : f(record)
  }

  const startTurn = (record: SessionRecord, prompt: string): ReadonlyArray<DomainEvent> => {
    const turn = new Turn({
      id: ctx.newTurnId,
      sessionId: record.session.id,
      index: record.turns.length,
      prompt,
      attachments: [...ctx.attachments],
      status: "working",
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: ctx.now,
      endedAt: null,
    })
    const live = record.session.state === "idle"
    return [
      DomainEvent.cases.TurnStarted.make({ turn }),
      stateChanged(record.session.id, live ? "working" : "starting"),
    ]
  }

  switch (command._tag) {
    case "RegisterWorkspace": {
      const probe = ctx.pathProbe
      if (probe === null || !probe.isDirectory) return reject(`${command.path} is not a directory`)
      for (const workspace of model.workspaces.values()) {
        if (workspace.path === command.path) return reject(`${command.path} is already registered`)
      }
      const workspace = new Workspace({
        id: ctx.newWorkspaceId,
        path: command.path,
        name: command.name ?? basename(command.path),
        isGitRepo: probe.isGitRepo,
        worktreeRoot: `${command.path}.worktrees`,
        hidden: false,
        registeredAt: ctx.now,
      })
      return ok(DomainEvent.cases.WorkspaceRegistered.make({ workspace }))
    }

    case "SetWorkspaceHidden": {
      const workspace = model.workspaces.get(command.workspaceId)
      if (workspace === undefined) return notFound("workspace", command.workspaceId)
      if (workspace.hidden === command.hidden) return ok()
      return ok(
        DomainEvent.cases.WorkspaceUpdated.make({
          workspace: new Workspace({ ...workspace, hidden: command.hidden }),
        }),
      )
    }

    case "RemoveWorkspace": {
      if (!model.workspaces.has(command.workspaceId)) {
        return notFound("workspace", command.workspaceId)
      }
      for (const record of model.sessions.values()) {
        if (
          record.session.workspaceId === command.workspaceId &&
          record.session.state !== "archived"
        ) {
          return reject("archive the Workspace's Agent Sessions before removing it")
        }
      }
      return ok(DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: command.workspaceId }))
    }

    case "StartSession": {
      if (model.sessions.has(command.sessionId)) {
        return reject(`session ${command.sessionId} already exists`)
      }
      const workspace = model.workspaces.get(command.workspaceId)
      if (workspace === undefined) return notFound("workspace", command.workspaceId)

      let cwd = workspace.path
      let worktreeId: WorktreeId | null = null
      const placement = command.placement
      if (placement._tag === "NewWorktree") {
        if (!workspace.isGitRepo) return reject("a new Worktree needs a git repository")
        const branch = placement.branch.trim()
        if (
          branch === "" ||
          branch.startsWith("/") ||
          branch.startsWith("-") ||
          branch.split("/").some((part) => part === ".." || part === ".")
        ) {
          return reject(`"${placement.branch}" is not a usable branch name`)
        }
        cwd = join(workspace.worktreeRoot, branch)
        worktreeId = worktreeIdFor(cwd)
        if (model.worktrees.has(worktreeId)) return reject(`a Worktree already exists at ${cwd}`)
      } else if (placement._tag === "ExistingWorktree") {
        const worktree = [...model.worktrees.values()].find(
          (w) => w.workspaceId === workspace.id && w.path === placement.path,
        )
        if (worktree === undefined) return notFound("worktree", placement.path)
        cwd = worktree.path
        worktreeId = worktree.id
      }

      const session = new AgentSession({
        id: command.sessionId,
        workspaceId: workspace.id,
        harness: command.harness,
        title: titleFromPrompt(command.prompt),
        cwd,
        worktreeId,
        state: "starting",
        permissionMode: command.permissionMode,
        model: command.model,
        parentSessionId: null,
        forkedFromTurnId: null,
        harnessCursor: null,
        turnCount: 0,
        lastError: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      const record: SessionRecord = {
        session,
        titleLocked: false,
        turns: [],
        pending: new Map(),
      }
      // startTurn emits `starting` again for a non-live session; the state is already starting.
      const [turnStarted] = startTurn(record, command.prompt)
      return ok(DomainEvent.cases.SessionCreated.make({ session }), turnStarted!)
    }

    case "SendTurn":
      return withSession(command.sessionId, (record) => {
        const { state } = record.session
        if (state === "archived") return reject("the session is Archived")
        if (state === "in-terminal") return reject("the session is In Terminal; return it first")
        if (!acceptsTurn(record)) return reject(`the session is ${state}; wait for the Turn to end`)
        return ok(...startTurn(record, command.prompt))
      })

    case "Continue":
      return withSession(command.sessionId, (record) => {
        const last = lastTurn(record)
        if (last === undefined || last.status !== "interrupted") {
          return reject("there is no Interrupted Turn to continue")
        }
        if (record.session.state === "in-terminal" || record.session.state === "archived") {
          return reject(`the session is ${record.session.state}`)
        }
        if (!acceptsTurn(record)) return reject(`the session is ${record.session.state}`)
        // The same Turn resumes: it goes back to working and keeps its before-checkpoint.
        const turn = new Turn({ ...last, status: "working", endedAt: null })
        const live = record.session.state === "idle"
        return ok(
          DomainEvent.cases.TurnStarted.make({ turn }),
          stateChanged(record.session.id, live ? "working" : "starting"),
        )
      })

    case "Steer":
      return withSession(command.sessionId, (record) => {
        if (workingTurn(record) === undefined || record.session.state === "in-terminal") {
          return reject("there is no Turn in flight to steer")
        }
        if (!ctx.canSteer) return reject(`${record.session.harness} does not support steering`)
        return ok()
      })

    case "Interrupt":
      return withSession(command.sessionId, (record) =>
        workingTurn(record) === undefined ? reject("there is no Turn in flight") : ok(),
      )

    case "RespondToApproval":
      return withSession(command.sessionId, (record) => {
        if (!record.pending.has(command.requestId)) {
          return reject(`request ${command.requestId} is already resolved`)
        }
        const events: Array<DomainEvent> = [
          DomainEvent.cases.ApprovalResolved.make({
            sessionId: command.sessionId,
            requestId: command.requestId,
            decision: command.decision,
            resolvedBy: ctx.deviceLabel,
          }),
        ]
        if (record.pending.size === 1 && record.session.state === "needs-you") {
          events.push(stateChanged(command.sessionId, "working"))
        }
        return ok(...events)
      })

    case "RenameSession":
      return withSession(command.sessionId, () => {
        const title = command.title.trim()
        if (title === "") return reject("a title cannot be empty")
        return ok(DomainEvent.cases.SessionRenamed.make({ sessionId: command.sessionId, title }))
      })

    case "SetPermissionMode":
      return withSession(command.sessionId, (record) => {
        if (record.session.state === "archived") return reject("the session is Archived")
        if (record.session.permissionMode === command.permissionMode) return ok()
        return ok(
          DomainEvent.cases.SessionPermissionModeChanged.make({
            sessionId: command.sessionId,
            permissionMode: command.permissionMode,
          }),
        )
      })

    case "ForkSession": {
      if (model.sessions.has(command.sessionId)) {
        return reject(`session ${command.sessionId} already exists`)
      }
      return withSession(command.fromSessionId, (parent) => {
        const turn = parent.turns.find((t) => t.id === command.fromTurnId)
        if (turn === undefined) return notFound("turn", command.fromTurnId)
        if (turn.status === "working") return reject("the Turn is still in flight")
        const sameHarness = parent.session.harness === command.harness
        // TODO(git): put the Fork in its own Worktree at the Turn's checkpoint.
        const session = new AgentSession({
          id: command.sessionId,
          workspaceId: parent.session.workspaceId,
          harness: command.harness,
          title: `Fork of ${parent.session.title}`,
          cwd: parent.session.cwd,
          worktreeId: parent.session.worktreeId,
          state: "dormant",
          permissionMode: parent.session.permissionMode,
          model: sameHarness ? parent.session.model : null,
          parentSessionId: parent.session.id,
          forkedFromTurnId: turn.id,
          harnessCursor: null,
          turnCount: 0,
          lastError: null,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        return ok(DomainEvent.cases.SessionCreated.make({ session }))
      })
    }

    case "ArchiveSession":
      return withSession(command.sessionId, (record) => {
        const { state } = record.session
        if (state === "archived") return reject("the session is already Archived")
        if (workingTurn(record) !== undefined && liveStates.includes(state)) {
          return reject("interrupt the Turn in flight before archiving")
        }
        return ok(stateChanged(command.sessionId, "archived"))
      })

    case "UnarchiveSession":
      return withSession(command.sessionId, (record) =>
        record.session.state !== "archived"
          ? reject("the session is not Archived")
          : ok(stateChanged(command.sessionId, "dormant")),
      )

    case "OpenInTerminal":
      return withSession(command.sessionId, (record) => {
        const { state } = record.session
        if (state !== "idle" && state !== "dormant" && state !== "failed") {
          return reject(`the session is ${state}`)
        }
        return ok(stateChanged(command.sessionId, "in-terminal"))
      })

    case "ReturnFromTerminal":
      return withSession(command.sessionId, (record) =>
        record.session.state !== "in-terminal"
          ? reject("the session is not In Terminal")
          : ok(stateChanged(command.sessionId, "starting")),
      )
  }
}
