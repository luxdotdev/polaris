/**
 * Reactors: what the engine does after a command commits (and after its ack):
 * open Harnesses and hand them Turns, create or remove Worktrees, prune
 * checkpoints, hand sessions to and from the terminal.
 */
import {
  type ApprovalDecision,
  type ApprovalRequest,
  Command,
  DomainEvent,
  type EventEnvelope,
  type NotFound,
  type SessionId,
  type Turn,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate } from "effect";
import type { HarnessError } from "../harness/HarnessDriver.ts";
import type { ServiceError } from "../services.ts";
import type { CommitResult } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";
import { CONTINUE_PROMPT } from "./decider.ts";
import { CheckpointPruning } from "./pruning.ts";
import { ReviewCheckouts } from "./reviewCheckouts.ts";
import { EngineRuntime } from "./runtime.ts";
import { Supervisor } from "./supervisor.ts";
import { TerminalHandoff } from "./terminal.ts";
import { Worktrees } from "./worktrees.ts";

export type Reaction = Effect.Effect<void, ServiceError | HarnessError | NotFound>;

/** A command that committed, and the model it was decided against. */
export interface Committed {
  readonly command: Command;
  readonly result: Extract<CommitResult, { _tag: "Committed" }>;
  readonly before: ReadModel;
}

type CommandOf<Tag extends Command["_tag"]> = Extract<Command, { _tag: Tag }>;

const turnFrom = (envelopes: ReadonlyArray<EventEnvelope>): Turn | undefined => {
  for (const envelope of envelopes) {
    if (Predicate.isTagged(envelope.event, "TurnStarted")) return envelope.event.turn;
  }

  return undefined;
};

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const supervisor = yield* Supervisor;
  const terminal = yield* TerminalHandoff;
  const worktrees = yield* Worktrees;
  const pruning = yield* CheckpointPruning;
  const checkouts = yield* ReviewCheckouts;
  const { live } = rt;

  const runStartedTurn = (sessionId: SessionId, envelopes: ReadonlyArray<EventEnvelope>) => {
    const turn = turnFrom(envelopes);

    return turn === undefined
      ? Effect.void
      : supervisor.runTurn({
          sessionId,
          turnId: turn.id,
          prompt: turn.prompt,
          attachments: turn.attachments,
        });
  };

  const registerWorkspace = ({ result }: Committed) =>
    Effect.gen(function* () {
      const workspace = result.envelopes
        .map((e) => e.event)
        .find(DomainEvent.isAnyOf(["WorkspaceRegistered"]))?.workspace;

      if (workspace === undefined || !workspace.isGitRepo) return;
      yield* worktrees.detectExisting(workspace);
    });

  const startSession = (command: CommandOf<"StartSession">, { result }: Committed) =>
    Effect.gen(function* () {
      const record = result.model.sessions.get(command.sessionId);
      const workspace = result.model.workspaces.get(command.workspaceId);
      const turn = turnFrom(result.envelopes);

      if (record === undefined || workspace === undefined || turn === undefined) return;

      if (Predicate.isTagged(command.placement, "NewWorktree")) {
        const created = yield* worktrees.create(command.sessionId, workspace, {
          path: record.session.cwd,
          branch: command.placement.branch.trim(),
          baseRef: command.placement.baseRef,
        });

        if (!created) return;
      }

      yield* supervisor.runTurn({
        sessionId: command.sessionId,
        turnId: turn.id,
        prompt: turn.prompt,
        attachments: turn.attachments,
      });
    });

  const continueTurn = (sessionId: SessionId, { result }: Committed) => {
    const turn = turnFrom(result.envelopes);

    return turn === undefined
      ? Effect.void
      : supervisor.runTurn({
          sessionId,
          turnId: turn.id,
          prompt: CONTINUE_PROMPT,
          attachments: [],
        });
  };

  const interrupt = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const entry = live.get(sessionId);

      if (entry !== undefined) return yield* entry.session.interrupt;
      // No Harness is running the Turn; end it here.
      yield* rt.signal(sessionId, { type: "turn.interruptUnattended", at: yield* rt.now });
    });

  const respond = (
    sessionId: SessionId,
    requestId: ApprovalRequest["id"],
    decision: ApprovalDecision
  ) =>
    Effect.gen(function* () {
      const entry = live.get(sessionId);

      if (entry === undefined) {
        return yield* Effect.logWarning(
          `no running Harness for ${sessionId} to answer ${requestId}`
        );
      }

      yield* entry.session.respond(requestId, decision);
    });

  const archive = (command: CommandOf<"ArchiveSession">) =>
    Effect.gen(function* () {
      const { sessionId } = command;
      yield* rt.cancelIdle(sessionId);
      yield* rt.stopHarness(sessionId);
      yield* terminal.stopFollower(sessionId, false);
      rt.terminalLaunch.delete(sessionId);
      const model = yield* rt.store.model;
      yield* worktrees.removeArchived(sessionId, model, command.deleteMergedBranch);
      const record = model.sessions.get(sessionId);
      const workspace = record && model.workspaces.get(record.session.workspaceId);

      if (record !== undefined && workspace?.isGitRepo) {
        yield* pruning.onArchived(record, workspace, model);
      }

      yield* rt.attachmentStore.onSessionArchived(sessionId);
    });

  const removeWorkspace = (command: CommandOf<"RemoveWorkspace">, { result, before }: Committed) =>
    Effect.suspend(() => {
      // Look the Workspace up in the model before its removal.
      const workspace = before.workspaces.get(command.workspaceId);

      if (workspace === undefined || !workspace.isGitRepo) return Effect.void;

      const sessionIds = [...result.model.sessions.values()].flatMap((record) =>
        record.session.workspaceId === workspace.id ? [record.session.id] : []
      );

      return Effect.andThen(
        pruning.onWorkspaceRemoved(workspace, sessionIds),
        checkouts.workspaceRemoved(workspace)
      );
    });

  /** Run the reactor for a command that committed. */
  const react = (committed: Committed): Reaction =>
    Command.match<Reaction>(committed.command, {
      RegisterWorkspace: () => registerWorkspace(committed),
      StartSession: (command) => startSession(command, committed),
      SendTurn: (command) => runStartedTurn(command.sessionId, committed.result.envelopes),
      Continue: (command) => continueTurn(command.sessionId, committed),
      Retry: (command) => runStartedTurn(command.sessionId, committed.result.envelopes),
      Steer: (command) =>
        Effect.suspend(
          () => live.get(command.sessionId)?.session.steer(command.text) ?? Effect.void
        ),
      Interrupt: (command) => interrupt(command.sessionId),
      RespondToApproval: (command) =>
        respond(command.sessionId, command.requestId, command.decision),
      SetPermissionMode: (command) =>
        Effect.suspend(
          () =>
            live.get(command.sessionId)?.session.setPermissionMode(command.permissionMode) ??
            Effect.void
        ),
      // The next Turn carries the Model and effort to the Harness (TurnInput).
      SetModel: () => Effect.void,
      ArchiveSession: archive,
      OpenInTerminal: (command) => terminal.openInTerminal(command.sessionId),
      ReturnFromTerminal: (command) => terminal.returnFromTerminal(command.sessionId),
      ForkSession: (command) => worktrees.createForFork(command, committed.result.model),
      UnarchiveSession: (command) => worktrees.restore(command.sessionId),
      RemoveWorkspace: (command) => removeWorkspace(command, committed),
      SetWorkspaceHidden: () => Effect.void,
      RenameSession: () => Effect.void,
      SendFeedback: (command) => runStartedTurn(command.sessionId, committed.result.envelopes),
      // TODO(M2-A accept): restore the working tree for `revertLaterTurns` and record TurnsReverted.
      AcceptTurns: () => Effect.void,
      LinkPullRequest: () => Effect.void,
      OpenReviewCheckout: (command) => checkouts.opened(command.checkoutId),
      // A new head makes the checkout stale; updating it is the user's call.
      ReportReviewHead: () => Effect.void,
      UpdateReviewCheckout: (command) =>
        checkouts.updated(command.checkoutId, command.discardChanges, committed.before),
      RemoveReviewCheckout: (command) => checkouts.removed(command.checkoutId),
      RecordVerdict: () => Effect.void,
    });

  return Reactors.of({ react });
});

/** What runs after a command commits. */
export class Reactors extends Context.Service<
  Reactors,
  { readonly react: (committed: Committed) => Reaction }
>()("polaris/daemon/engine/Reactors") {
  static readonly layer = Layer.effect(Reactors, make);
}
