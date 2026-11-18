/** Copies of a session or a Turn with some fields changed, for the fold and the deciders. */
import { AgentSession, QueuedTurn, Turn } from "@polaris/protocol";

export type SessionPatch = Partial<typeof AgentSession.Type>;

/** A copy of `session` with `patch` applied. */
export const patchSession = (session: AgentSession, patch: SessionPatch): AgentSession =>
  new AgentSession({
    id: session.id,
    workspaceId: session.workspaceId,
    harness: session.harness,
    title: session.title,
    cwd: session.cwd,
    worktreeId: session.worktreeId,
    state: session.state,
    permissionMode: session.permissionMode,
    model: session.model,
    effort: session.effort,
    serviceTier: session.serviceTier,
    celestial: session.celestial,
    parentSessionId: session.parentSessionId,
    forkedFromTurnId: session.forkedFromTurnId,
    harnessCursor: session.harnessCursor,
    turnCount: session.turnCount,
    currentUserTurn: session.currentUserTurn,
    lastReplyPreview: session.lastReplyPreview,
    contextUsage: session.contextUsage,
    lastCompaction: session.lastCompaction,
    suggestedReply: session.suggestedReply,
    backgroundTasks: session.backgroundTasks,
    backgroundChangedAt: session.backgroundChangedAt,
    backgroundReportsPending: session.backgroundReportsPending,
    worktreeSetup: session.worktreeSetup,
    lastError: session.lastError,
    acceptedThroughIndex: session.acceptedThroughIndex,
    acceptedThroughUserTurn: session.acceptedThroughUserTurn,
    pullRequest: session.pullRequest,
    origin: session.origin,
    reviewSubject: session.reviewSubject,
    worker: session.worker,
    pinnedAt: session.pinnedAt,
    limitResetsAt: session.limitResetsAt,
    resumeAtReset: session.resumeAtReset,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...patch,
  });

export type TurnPatch = Partial<typeof Turn.Type>;

/** A copy of `turn` with `patch` applied. */
/** `commentIds` is an optional key: it is kept only when the Turn has it. */
export const patchTurn = (turn: Turn, patch: TurnPatch): Turn => {
  const fields = {
    id: turn.id,
    sessionId: turn.sessionId,
    index: turn.index,
    prompt: turn.prompt,
    trigger: turn.trigger,
    userTurnNumber: turn.userTurnNumber,
    replyPreview: turn.replyPreview,
    attachments: turn.attachments,
    model: turn.model,
    effort: turn.effort,
    serviceTier: turn.serviceTier,
    status: turn.status,
    feedback: turn.feedback,
    actor: turn.actor,
    shellCommand: turn.shellCommand,
    idleCompaction: turn.idleCompaction,
    checkpointBefore: turn.checkpointBefore,
    checkpointAfter: turn.checkpointAfter,
    checkpointAfterCommit: turn.checkpointAfterCommit,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
  };

  return new Turn(
    turn.commentIds === undefined
      ? { ...fields, ...patch }
      : { ...fields, commentIds: turn.commentIds, ...patch }
  );
};

/** A copy of `queued` with `patch` applied; a queued `SendFeedback`'s Comments are kept. */
export const patchQueuedTurn = (
  queued: QueuedTurn,
  patch: Partial<typeof QueuedTurn.Type>
): QueuedTurn => {
  const fields = {
    id: queued.id,
    sessionId: queued.sessionId,
    prompt: queued.prompt,
    attachments: queued.attachments,
    actor: queued.actor,
    queuedAt: queued.queuedAt,
    editedAt: queued.editedAt,
    approves: queued.approves,
    feedback: queued.feedback,
  };

  return new QueuedTurn(
    queued.commentIds === undefined
      ? { ...fields, ...patch }
      : { ...fields, commentIds: queued.commentIds, ...patch }
  );
};
