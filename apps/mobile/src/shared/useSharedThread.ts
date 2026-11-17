/**
 * A thread's sharing (DESIGN.md "Shared Sessions", SS6): who is looking and as what, who is
 * watching now, the Comment being written, and the Comment commands, sent over the thread's
 * connection. Nothing shows in a session that was never shared (rule/solo-is-unchanged).
 */
import {
  Command,
  type Comment,
  type CommentAnchor,
  type SessionId,
  type SharePresenceEntry,
  ShareTarget,
  type TurnId,
} from "@polaris/protocol";
import { Effect, Fiber, Predicate, Stream } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { harnessName } from "../home/model/format.ts";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { SessionFold } from "../thread/fold.ts";
import { newCommandId } from "../thread/source.ts";
import { addComment, resolveComment, sendComments } from "./commands.ts";
import { type QueueView, queueView } from "./queue.ts";
import {
  OWNER,
  sendsTurns,
  showsSharing,
  turnNumberOf,
  unsentComments,
  type Viewer,
} from "./model.ts";

/** What a new Comment is on: a message, or a diff thread it replies to. */
export interface CommentTarget {
  readonly anchor: CommentAnchor;
  /** The text the composer quotes. */
  readonly quote: string;
}

/** Which Comments the sheet lists: a message's, or the line threads of a step's files. */
export type CommentsOpen =
  | { readonly kind: "message"; readonly messageId: string; readonly target: CommentTarget }
  | {
      readonly kind: "step";
      readonly turnId: string;
      readonly paths: ReadonlyArray<string>;
      readonly label: string;
    };

/** What the thread's rows need to show and start Comments. */
export interface RowSharing {
  readonly viewer: Viewer;
  readonly comments: ReadonlyArray<Comment>;
  readonly turnNumber: (turnId: string | null | undefined) => number | null;
  /** "Claude Code", in "on Claude Code's message". */
  readonly harness: string;
  readonly onComment: (target: CommentTarget) => void;
  readonly onOpen: (open: CommentsOpen) => void;
}

export interface SharedThread {
  readonly viewer: Viewer;
  /** False in a session never shared: the thread draws as it always has. */
  readonly shown: boolean;
  readonly presence: ReadonlyArray<SharePresenceEntry>;
  /** For `Row`; undefined while nothing is shared. */
  readonly rows: RowSharing | undefined;
  readonly target: CommentTarget | null;
  readonly setTarget: (target: CommentTarget | null) => void;
  readonly opened: CommentsOpen | null;
  readonly setOpened: (open: CommentsOpen | null) => void;
  /** Comments neither sent nor resolved, when this viewer may send them as a Turn. */
  readonly sendable: ReadonlyArray<Comment>;
  /** Each resolves with the Host's refusal, or null. */
  readonly comment: (target: CommentTarget, body: string) => Promise<string | null>;
  readonly resolve: (comment: Comment, resolve: boolean) => Promise<string | null>;
  readonly send: () => Promise<string | null>;
  /** The session's queued Turns (ENG-941), and the queue's commands. */
  readonly queue: QueueView;
  readonly cancelQueued: (turnId: TurnId) => Promise<string | null>;
  readonly editQueued: (turnId: TurnId, prompt: string) => Promise<string | null>;
  readonly resumeQueue: () => Promise<string | null>;
}

const NO_COMMENTS: ReadonlyArray<Comment> = [];

/** The viewer's role on this session: their live Share's, else the one they accepted. */
const roleOn = (live: ReturnType<typeof useLiveHost>, sessionId: SessionId) =>
  live?.shares.find(
    (held) => Predicate.isTagged(held.target, "Session") && held.target.sessionId === sessionId
  )?.role ?? null;

/** Who has the session open, while the Host serves Shares. */
const usePresence = (connection: HostConnection | null, sessionId: SessionId) => {
  const live = useLiveHost(connection);
  const [presence, setPresence] = useState<ReadonlyArray<SharePresenceEntry>>([]);
  const serves = live?.capabilities.includes("shares") ?? false;

  useEffect(() => {
    if (live === null || !serves) return;

    const fiber = Effect.runFork(
      live.client["shares.watchPresence"]({
        target: ShareTarget.cases.Session.make({ sessionId }),
      }).pipe(
        Stream.runForEach((entries) => Effect.sync(() => setPresence(entries))),
        Effect.ignore
      )
    );

    return () => void Effect.runFork(Fiber.interrupt(fiber));
  }, [live, serves, sessionId]);

  return presence;
};

export const useSharedThread = (
  connection: HostConnection | null,
  sessionId: SessionId,
  fold: SessionFold | null
): SharedThread => {
  const live = useLiveHost(connection);
  const teammate = connection?.teammate ?? null;
  const role = roleOn(live, sessionId) ?? teammate?.role ?? null;

  const viewer = useMemo(
    (): Viewer =>
      teammate === null || role === null
        ? OWNER
        : { kind: "teammate", personId: teammate.personId, role, ownerName: teammate.ownerName },
    [teammate, role]
  );

  const presence = usePresence(connection, sessionId);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [opened, setOpened] = useState<CommentsOpen | null>(null);
  const comments = fold?.comments ?? NO_COMMENTS;
  const turns = fold?.turns;

  const shown =
    showsSharing(viewer, turns ?? [], comments) ||
    presence.some((entry) => Predicate.isTagged(entry.actor, "Teammate"));

  const dispatch = useCallback(
    async (command: Command): Promise<string | null> => {
      if (connection === null) return "This host isn't connected";

      return connection
        .run((client) =>
          client.dispatch({ commandId: newCommandId(), command }).pipe(
            Effect.match({
              onFailure: (error) => error.message,
              onSuccess: () => null,
            })
          )
        )
        .catch(() => `${connection.name} isn't connected`);
    },
    [connection]
  );

  const turnNumber = useMemo(() => turnNumberOf(turns ?? []), [turns]);
  const harness = harnessName(fold?.session.harness ?? "the agent");

  const rows = useMemo(
    (): RowSharing | undefined =>
      shown
        ? { viewer, comments, turnNumber, harness, onComment: setTarget, onOpen: setOpened }
        : undefined,
    [shown, viewer, comments, turnNumber, harness]
  );

  return {
    viewer,
    shown,
    presence,
    rows,
    target,
    setTarget,
    opened,
    setOpened,
    sendable: shown && sendsTurns(viewer) ? unsentComments(comments) : NO_COMMENTS,
    comment: (on, body) => dispatch(addComment(sessionId, on.anchor, body)),
    resolve: (comment, resolve) => dispatch(resolveComment(comment, resolve)),
    send: () => dispatch(sendComments(sessionId, unsentComments(comments))),
    queue: queueView(fold),
    cancelQueued: (turnId) => dispatch(Command.cases.CancelQueuedTurn.make({ sessionId, turnId })),
    editQueued: (turnId, prompt) =>
      dispatch(Command.cases.EditQueuedTurn.make({ sessionId, turnId, prompt })),
    resumeQueue: () => dispatch(Command.cases.ResumeQueue.make({ sessionId })),
  };
};
