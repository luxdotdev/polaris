/**
 * Worktrees as the engine's reactors manage them: detected when a Workspace
 * is registered, created for a `NewWorktree` placement or a Fork, removed on
 * Archive (the branch stays) and recreated from that branch on Unarchive.
 */
import {
  DomainEvent,
  type SessionId,
  type TurnId,
  type Workspace,
  type WorkspaceId,
  Worktree,
} from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import type { ServiceError } from "../services.ts";
import type { ReadModel } from "../store/model.ts";
import { forkBranch, worktreeIdFor } from "./decider.ts";
import { EngineRuntime } from "./runtime.ts";

/** Where a new Worktree goes. An existing `branch` is checked out as is; otherwise it is created at `baseRef`. */
export interface WorktreePlacement {
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string | null;
}

/** A Fork, and the parent Turn it started from. */
export interface ForkOrigin {
  readonly sessionId: SessionId;
  readonly fromSessionId: SessionId;
  readonly fromTurnId: TurnId;
}

const make = (rt: EngineRuntime["Service"]): Worktrees["Service"] => {
  const { store } = rt;

  const detected = (worktree: Worktree) => DomainEvent.cases.WorktreeDetected.make({ worktree });

  const create = (sessionId: SessionId, workspace: Workspace, placement: WorktreePlacement) =>
    Effect.gen(function* () {
      const created = yield* rt.worktrees
        .create({ repoPath: workspace.path, ...placement })
        .pipe(
          Effect.catch((error) =>
            rt
              .failSession(sessionId, `could not create the Worktree: ${error.message}`)
              .pipe(Effect.as(null))
          )
        );

      if (created === null) return false;
      yield* rt.recordFor(sessionId, () => [
        detected(
          new Worktree({
            id: worktreeIdFor(placement.path),
            workspaceId: workspace.id,
            path: placement.path,
            branch: created.branch,
            head: created.head,
            createdBySessionId: sessionId,
            isMain: false,
          })
        ),
      ]);

      return true;
    });

  const detectExisting = (workspace: Workspace) =>
    Effect.gen(function* () {
      const listed = yield* rt.worktrees.list(workspace.path);
      yield* store.commit({
        commandId: null,
        decide: (model) =>
          Effect.succeed(
            listed.flatMap((info) =>
              model.worktrees.has(worktreeIdFor(info.path))
                ? []
                : [
                    detected(
                      new Worktree({
                        id: worktreeIdFor(info.path),
                        workspaceId: workspace.id,
                        path: info.path,
                        branch: info.branch,
                        head: info.head,
                        createdBySessionId: null,
                        isMain: info.isMain,
                      })
                    ),
                  ]
            )
          ),
      });
    });

  const removeArchived = (sessionId: SessionId, model: ReadModel, deleteMergedBranch: boolean) =>
    Effect.gen(function* () {
      const record = model.sessions.get(sessionId);

      const worktree = record?.session.worktreeId
        ? model.worktrees.get(record.session.worktreeId)
        : undefined;

      const workspace = record && model.workspaces.get(record.session.workspaceId);

      const sharedWithActive = [...model.sessions.values()].some(
        (other) =>
          other.session.id !== sessionId &&
          other.session.worktreeId === worktree?.id &&
          other.session.state !== "archived"
      );

      if (
        worktree === undefined ||
        workspace === undefined ||
        worktree.createdBySessionId !== sessionId ||
        worktree.isMain ||
        sharedWithActive
      )
        return;

      yield* rt.worktrees.remove({
        repoPath: workspace.path,
        path: worktree.path,
        deleteBranchIfMerged: deleteMergedBranch,
      });
      yield* rt.recordFor(sessionId, () => [removed(workspace.id, worktree.id)]);
    });

  const removed = (workspaceId: WorkspaceId, worktreeId: Worktree["id"]) =>
    DomainEvent.cases.WorktreeRemoved.make({ workspaceId, worktreeId });

  const createForFork = (fork: ForkOrigin, model: ReadModel) =>
    Effect.gen(function* () {
      const record = model.sessions.get(fork.sessionId);
      const worktreeId = record?.session.worktreeId ?? null;

      // No Worktree of its own (not a git repo, or no checkpoint): it shares the parent's cwd.
      if (record === undefined || worktreeId === null || model.worktrees.has(worktreeId)) return;
      const workspace = model.workspaces.get(record.session.workspaceId);
      const turn = yield* rt.findTurn(fork.fromSessionId, fork.fromTurnId);

      if (workspace === undefined || turn?.checkpointAfter == null) return;
      yield* create(fork.sessionId, workspace, {
        path: record.session.cwd,
        branch: forkBranch(fork.sessionId),
        baseRef: turn.checkpointAfter,
      });
    });

  const restore = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const record = model.sessions.get(sessionId);
      const worktreeId = record?.session.worktreeId ?? null;

      if (record === undefined || worktreeId === null || model.worktrees.has(worktreeId)) return;
      const workspace = model.workspaces.get(record.session.workspaceId);
      const known = yield* store.lastKnownWorktree(worktreeId);

      if (
        workspace === undefined ||
        known === null ||
        known.isMain ||
        known.branch === null ||
        known.createdBySessionId !== sessionId
      )
        return;
      yield* create(sessionId, workspace, {
        path: known.path,
        branch: known.branch,
        baseRef: null,
      });
    });

  return { create, detectExisting, removeArchived, createForFork, restore };
};

export class Worktrees extends Context.Service<
  Worktrees,
  {
    /** Create a Worktree for a session and record it; on failure the session goes Failed. */
    readonly create: (
      sessionId: SessionId,
      workspace: Workspace,
      placement: WorktreePlacement
    ) => Effect.Effect<boolean, ServiceError>;
    /** Record the Worktrees a newly registered git Workspace already has. */
    readonly detectExisting: (workspace: Workspace) => Effect.Effect<void, ServiceError>;
    /** Remove the Worktree an Archived session created, unless another active session uses it. */
    readonly removeArchived: (
      sessionId: SessionId,
      model: ReadModel,
      deleteMergedBranch: boolean
    ) => Effect.Effect<void, ServiceError>;
    /** A Fork of a Turn with an after-checkpoint gets its own Worktree at that checkpoint. */
    readonly createForFork: (
      fork: ForkOrigin,
      model: ReadModel
    ) => Effect.Effect<void, ServiceError>;
    /** Archive removed the Worktree the session created and kept its branch: bring it back. */
    readonly restore: (sessionId: SessionId) => Effect.Effect<void, ServiceError>;
  }
>()("polaris/daemon/engine/Worktrees") {
  static readonly layer = Layer.effect(
    Worktrees,
    Effect.gen(function* () {
      return make(yield* EngineRuntime);
    })
  );
}
