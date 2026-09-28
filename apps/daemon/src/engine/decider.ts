/**
 * The decider: validates a Client command against the current read model and
 * returns the events that record its intent. It is pure; everything it needs
 * from the outside world (ids, the clock, resolved attachments, a filesystem
 * probe) arrives in `DecideContext`. Side effects happen after commit, in the
 * reactors (`Engine.ts`).
 *
 * Everything that moves a Session State goes through the session lifecycle
 * machine (`session.ts`); this module builds its inputs and maps its output.
 */
import { basename, join } from "node:path";
import {
  AgentSession,
  type Attachment,
  type Command,
  type CommandId,
  CommandRejected,
  DomainEvent,
  NotFound,
  type SessionId,
  Turn,
  type TurnId,
  Workspace,
  type WorkspaceId,
  WorktreeId,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ReadModel, SessionRecord } from "../store/model.ts";
import { decideSession, type SessionInput } from "./session.ts";

export { stateChanged } from "./session.ts";

export interface DecideContext {
  readonly commandId: CommandId;
  readonly now: string;
  /** Label of the Client device that sent the command (for `ApprovalResolved.resolvedBy`). */
  readonly deviceLabel: string;
  /** Fresh ids, used only by the commands that create something. */
  readonly newTurnId: TurnId;
  readonly newWorkspaceId: WorkspaceId;
  /** Attachments of StartSession / SendTurn, resolved from the AttachmentStore. */
  readonly attachments: ReadonlyArray<Attachment>;
  /** For RegisterWorkspace: what is at `path`. */
  readonly pathProbe: { readonly isDirectory: boolean; readonly isGitRepo: boolean } | null;
  /** For Steer: whether the session's Harness supports it. */
  readonly canSteer: boolean;
  /** For ForkSession: the Turn forked from, looked up in memory or SQL (null if unknown). */
  readonly forkTurn: Turn | null;
}

type Decision = Effect.Effect<ReadonlyArray<DomainEvent>, CommandRejected | NotFound>;

/** Worktree ids are derived from the path, so every observer of a path agrees on its id. */
export const worktreeIdFor = (path: string): WorktreeId =>
  WorktreeId.make(`wt_${Bun.hash(path).toString(16)}`);

/**
 * The branch of a Fork's own Worktree: `polaris/fork-<8 hex>`, derived from the
 * Fork's session id so the decider and the reactor agree on it.
 */
export const forkBranch = (sessionId: SessionId): string =>
  `polaris/fork-${Bun.hash(sessionId).toString(16).padStart(16, "0").slice(0, 8)}`;

export const titleFromPrompt = (prompt: string): string => {
  const line = prompt.trim().split("\n")[0]?.trim() ?? "";

  if (line === "") return "New session";

  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/** What the engine sends the Harness when the user continues an Interrupted Turn. */
export const CONTINUE_PROMPT = "Continue from where you left off.";

export const decide = (model: ReadModel, command: Command, ctx: DecideContext): Decision => {
  const reject = (reason: string) =>
    Effect.fail(new CommandRejected({ commandId: ctx.commandId, reason }));

  const notFound = (what: string, id: string) => Effect.fail(new NotFound({ what, id }));
  const ok = (...events: ReadonlyArray<DomainEvent>): Decision => Effect.succeed(events);

  const withSession = (sessionId: SessionId, f: (record: SessionRecord) => Decision): Decision => {
    const record = model.sessions.get(sessionId);

    return record === undefined ? notFound("session", sessionId) : f(record);
  };

  /** Run the session machine: its events, or its reason to refuse. */
  const lifecycle = (record: SessionRecord | undefined, input: SessionInput): Decision => {
    const decision = decideSession(record, input);

    return decision.rejection !== null ? reject(decision.rejection) : ok(...decision.events);
  };

  const newTurn = (session: AgentSession, prompt: string): Turn =>
    new Turn({
      id: ctx.newTurnId,
      sessionId: session.id,
      index: session.turnCount,
      prompt,
      attachments: [...ctx.attachments],
      status: "working",
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: ctx.now,
      endedAt: null,
    });

  switch (command._tag) {
    case "RegisterWorkspace": {
      const probe = ctx.pathProbe;

      if (probe === null || !probe.isDirectory) return reject(`${command.path} is not a directory`);

      for (const workspace of model.workspaces.values()) {
        if (workspace.path === command.path) return reject(`${command.path} is already registered`);
      }

      const workspace = new Workspace({
        id: ctx.newWorkspaceId,
        path: command.path,
        name: command.name ?? basename(command.path),
        isGitRepo: probe.isGitRepo,
        worktreeRoot: `${command.path}.worktrees`,
        hidden: false,
        registeredAt: ctx.now,
      });

      return ok(DomainEvent.cases.WorkspaceRegistered.make({ workspace }));
    }

    case "SetWorkspaceHidden": {
      const workspace = model.workspaces.get(command.workspaceId);

      if (workspace === undefined) return notFound("workspace", command.workspaceId);

      if (workspace.hidden === command.hidden) return ok();

      return ok(
        DomainEvent.cases.WorkspaceUpdated.make({
          workspace: new Workspace({ ...workspace, hidden: command.hidden }),
        })
      );
    }

    case "RemoveWorkspace": {
      if (!model.workspaces.has(command.workspaceId)) {
        return notFound("workspace", command.workspaceId);
      }

      for (const record of model.sessions.values()) {
        if (
          record.session.workspaceId === command.workspaceId &&
          record.session.state !== "archived"
        ) {
          return reject("archive the Workspace's Agent Sessions before removing it");
        }
      }

      return ok(DomainEvent.cases.WorkspaceRemoved.make({ workspaceId: command.workspaceId }));
    }

    case "StartSession": {
      if (model.sessions.has(command.sessionId)) {
        return reject(`session ${command.sessionId} already exists`);
      }

      const workspace = model.workspaces.get(command.workspaceId);

      if (workspace === undefined) return notFound("workspace", command.workspaceId);

      let cwd = workspace.path;
      let worktreeId: WorktreeId | null = null;
      const placement = command.placement;

      if (placement._tag === "NewWorktree") {
        if (!workspace.isGitRepo) return reject("a new Worktree needs a git repository");
        const branch = placement.branch.trim();

        if (
          branch === "" ||
          branch.startsWith("/") ||
          branch.startsWith("-") ||
          branch.split("/").some((part) => part === ".." || part === ".")
        ) {
          return reject(`"${placement.branch}" is not a usable branch name`);
        }

        cwd = join(workspace.worktreeRoot, branch);
        worktreeId = worktreeIdFor(cwd);

        if (model.worktrees.has(worktreeId)) return reject(`a Worktree already exists at ${cwd}`);
      } else if (placement._tag === "ExistingWorktree") {
        const worktree = [...model.worktrees.values()].find(
          (w) => w.workspaceId === workspace.id && w.path === placement.path
        );

        if (worktree === undefined) return notFound("worktree", placement.path);
        cwd = worktree.path;
        worktreeId = worktree.id;
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
      });

      return lifecycle(undefined, {
        type: "session.start",
        session,
        turn: newTurn(session, command.prompt),
      });
    }

    case "SendTurn":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "turn.send", turn: newTurn(record.session, command.prompt) })
      );

    case "Continue":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "turn.continue" })
      );

    case "Steer":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "turn.steer", canSteer: ctx.canSteer })
      );

    case "Interrupt":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "turn.interrupt" })
      );

    case "RespondToApproval":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, {
          type: "approval.respond",
          requestId: command.requestId,
          decision: command.decision,
          resolvedBy: ctx.deviceLabel,
        })
      );

    case "RenameSession":
      return withSession(command.sessionId, () => {
        const title = command.title.trim();

        if (title === "") return reject("a title cannot be empty");

        return ok(DomainEvent.cases.SessionRenamed.make({ sessionId: command.sessionId, title }));
      });

    case "SetPermissionMode":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "permissionMode.set", permissionMode: command.permissionMode })
      );

    case "ForkSession": {
      if (model.sessions.has(command.sessionId)) {
        return reject(`session ${command.sessionId} already exists`);
      }

      return withSession(command.fromSessionId, (parent) => {
        const turn =
          parent.turns.find((t) => t.id === command.fromTurnId) ??
          (ctx.forkTurn?.id === command.fromTurnId ? ctx.forkTurn : undefined);

        if (turn === undefined) return notFound("turn", command.fromTurnId);

        if (turn.status === "working") return reject("the Turn is still in flight");
        const sameHarness = parent.session.harness === command.harness;
        // The Fork gets its own Worktree on a new branch at the Turn's after-checkpoint
        // (the reactor creates it). Without a checkpoint (not a git repo, or the capture
        // failed) it shares the parent's directory.
        const workspace = model.workspaces.get(parent.session.workspaceId);
        let cwd = parent.session.cwd;
        let worktreeId = parent.session.worktreeId;

        if (workspace?.isGitRepo === true && turn.checkpointAfter !== null) {
          cwd = join(workspace.worktreeRoot, forkBranch(command.sessionId));
          worktreeId = worktreeIdFor(cwd);

          if (model.worktrees.has(worktreeId)) return reject(`a Worktree already exists at ${cwd}`);
        }

        const session = new AgentSession({
          id: command.sessionId,
          workspaceId: parent.session.workspaceId,
          harness: command.harness,
          title: `Fork of ${parent.session.title}`,
          cwd,
          worktreeId,
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
        });

        return lifecycle(undefined, { type: "session.fork", session });
      });
    }

    case "ArchiveSession":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "session.archive" })
      );

    case "UnarchiveSession":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "session.unarchive" })
      );

    case "OpenInTerminal":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "terminal.open" })
      );

    case "ReturnFromTerminal":
      return withSession(command.sessionId, (record) =>
        lifecycle(record, { type: "terminal.return" })
      );
  }
};
