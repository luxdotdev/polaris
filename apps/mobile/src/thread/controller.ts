/**
 * One open thread, outside React: folds the session's feed, follows its
 * cached findings, syncs the composer's draft (F3's DraftSync), reports the
 * read position, and holds queued follow-ups until the Turn in flight ends.
 * The screen reads it with `useSyncExternalStore`.
 */
import {
  applyContinuity,
  type ContinuityState,
  DRAFT_SAVE_DELAY_MS,
  type DraftStatus,
  type DraftSync,
  emptyContinuity,
  makeDraftSync,
} from "@polaris/client/continuity";
import {
  type AttachmentId,
  Command,
  type RiskFinding,
  type SessionId,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, Exit, Fiber, Stream } from "effect";
import {
  composerMode,
  type FollowUp,
  followUpCommand,
  sendQueues,
  submitCommand,
} from "./composer.ts";
import { applySessionItem, type SessionFold, summaryHead } from "./fold.ts";
import { newestEndedOnScreen } from "./rows.ts";
import type { ThreadFailure, ThreadSource } from "./source.ts";

export interface ThreadState {
  readonly fold: SessionFold | null;
  /** Why the session's feed ended, as the user reads it. */
  readonly failure: string | null;
  readonly findings: ReadonlyArray<RiskFinding>;
  readonly text: string;
  /** Null while the Host's continuity isn't live: nothing is claimed saved. */
  readonly draftStatus: DraftStatus | null;
  /** Follow-ups waiting for the Turn in flight, oldest first. */
  readonly queued: ReadonlyArray<FollowUp>;
  /** Why the last send or stop failed. */
  readonly error: string | null;
}

export interface ThreadController {
  readonly get: () => ThreadState;
  /** The Host can steer a Turn in flight. */
  readonly canSteer: boolean;
  /** A Workspace's name and path; null when unknown or it couldn't be read. */
  readonly workspace: (workspaceId: WorkspaceId) => Promise<Workspace | null>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly type: (text: string) => void;
  /** Sends or holds the draft with `attachments`; true when it was taken, so the chips can go. */
  readonly submit: (attachments?: ReadonlyArray<AttachmentId>) => Promise<boolean>;
  readonly queue: (attachments?: ReadonlyArray<AttachmentId>) => boolean;
  readonly interrupt: () => Promise<void>;
  /** The Host's connection came back: drafts that failed to save are written again. */
  readonly reconnected: () => void;
  /** The Turns with rows on screen while the app is in front. */
  readonly seen: (turnIds: ReadonlyArray<string>) => void;
  readonly dispose: () => void;
}

const initial: ThreadState = {
  fold: null,
  failure: null,
  findings: [],
  text: "",
  draftStatus: null,
  queued: [],
  error: null,
};

const lastTurnOf = (fold: SessionFold | null) => fold?.turns.at(-1)?.turn ?? null;

/** A queued follow-up may go once nothing is in flight and nothing waits on the user. */
const readyForFollowUp = (fold: SessionFold) =>
  lastTurnOf(fold)?.status !== "working" &&
  fold.session.state !== "working" &&
  fold.session.state !== "starting" &&
  fold.pendingApprovals.length === 0;

export interface ThreadControllerOptions {
  /** The pause after typing before the draft is written; DraftSync's default otherwise. */
  readonly draftDelayMs?: number;
}

export const openThread = (
  source: ThreadSource,
  sessionId: SessionId,
  options: ThreadControllerOptions = {}
): ThreadController => {
  let state = initial;
  let continuity: ContinuityState | null = null;
  let readRequested = -1;
  let followUpTurns: number | null = null;
  let findingsKey: string | null = null;
  let findingsFiber: Fiber.Fiber<void, ThreadFailure> | null = null;
  const listeners = new Set<() => void>();
  const fibers: Array<Fiber.Fiber<void, ThreadFailure>> = [];

  const set = (patch: Partial<ThreadState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const run = <A>(effect: Effect.Effect<A, ThreadFailure>) => Effect.runPromise(effect);

  /** Sends a command; answers why it failed, or null. */
  const send = (command: Command) =>
    Effect.runPromise(
      source
        .dispatch(command)
        .pipe(Effect.match({ onFailure: (error) => error.message, onSuccess: () => null }))
    );

  const drafts: DraftSync = makeDraftSync({
    delayMs: options.draftDelayMs ?? DRAFT_SAVE_DELAY_MS,
    save: (id, text) => run(source.saveDraft(id, text)).catch(() => null),
    adopt: (id, text) => {
      if (id === sessionId) set({ text });
    },
    status: (id, status) => {
      if (id === sessionId) set({ draftStatus: status });
    },
  });

  const follow = <A>(stream: Stream.Stream<A, ThreadFailure>, each: (item: A) => void) =>
    Effect.runFork(Stream.runForEach(stream, (item) => Effect.sync(() => each(item))));

  const followFindings = (fold: SessionFold) => {
    const head = summaryHead(fold);
    const ended = fold.turns.filter((entry) => entry.turn.status !== "working").length;
    const key = `${head ?? ""}:${ended}`;

    if (key === findingsKey) return;
    findingsKey = key;

    if (findingsFiber !== null) Effect.runFork(Fiber.interrupt(findingsFiber));
    findingsFiber = follow(
      source.findings({ sessionId, workspaceId: fold.session.workspaceId, head }),
      (findings) => set({ findings })
    );
  };

  const sendFollowUp = (fold: SessionFold) => {
    const next = state.queued[0];

    if (next === undefined || !readyForFollowUp(fold)) return;

    if (followUpTurns !== null && fold.session.turnCount <= followUpTurns) return;
    followUpTurns = fold.session.turnCount;
    set({ queued: state.queued.slice(1) });
    void send(followUpCommand(sessionId, next)).then((error) => {
      if (error === null) return;
      followUpTurns = null;
      set({ queued: [next, ...state.queued], error });
    });
  };

  fibers.push(
    follow(source.session(sessionId), (item) => {
      const fold = applySessionItem(state.fold, item);

      if (fold === state.fold || fold === null) return;
      set({ fold });
      followFindings(fold);
      sendFollowUp(fold);
    })
  );

  fibers.push(
    follow(source.continuity, (item) => {
      continuity = applyContinuity(continuity ?? emptyContinuity, item);
      const held = continuity.drafts.get(sessionId);

      if (held !== undefined) drafts.receive(held);
    })
  );

  fibers[0]?.addObserver((exit) => {
    if (Exit.isFailure(exit)) set({ failure: "This session's feed stopped" });
  });

  const type = (text: string) => {
    set({ text, error: null });

    if (continuity !== null) drafts.edit(sessionId, text);
  };

  const clearSent = () => {
    type("");
    void drafts.flush(sessionId);
  };

  const queue = (attachments: ReadonlyArray<AttachmentId> = []) => {
    const text = state.text.trim();

    if (text === "") return false;
    set({ queued: [...state.queued, { text, attachments }] });
    clearSent();

    return true;
  };

  const submit = async (attachments: ReadonlyArray<AttachmentId> = []) => {
    const fold = state.fold;

    if (fold === null) return false;

    const mode = composerMode({
      state: fold.session.state,
      lastTurn: lastTurnOf(fold)?.status ?? null,
      pendingApprovals: fold.pendingApprovals,
      canSteer: source.canSteer,
    });

    if (sendQueues(mode, attachments)) return queue(attachments);
    const command = submitCommand(mode, sessionId, state.text, attachments);

    if (command === null) return false;

    const error = await send(command);

    if (error === null) clearSent();
    else set({ error });

    return error === null;
  };

  const interrupt = async () => {
    const error = await send(Command.cases.Interrupt.make({ sessionId }));

    if (error !== null) set({ error });
  };

  const seen = (turnIds: ReadonlyArray<string>) => {
    const fold = state.fold;

    if (fold === null || continuity === null) return;
    const newest = newestEndedOnScreen(fold.turns, turnIds);
    const held = continuity.reads.get(sessionId)?.turnIndex ?? -1;

    if (newest === null || newest.turn.index <= Math.max(held, readRequested)) return;
    readRequested = newest.turn.index;
    void run(source.markRead(sessionId, newest.turn.id)).catch(() => {
      readRequested = -1;
    });
  };

  return {
    get: () => state,
    canSteer: source.canSteer,
    workspace: (workspaceId) => run(source.workspace(workspaceId)).catch(() => null),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    type,
    submit,
    queue,
    interrupt,
    seen,
    reconnected: () => void drafts.retry(),
    dispose: () => {
      void drafts.flush(sessionId).finally(() => drafts.dispose());
      [...fibers, ...(findingsFiber === null ? [] : [findingsFiber])].forEach((fiber) =>
        Effect.runFork(Fiber.interrupt(fiber))
      );
      listeners.clear();
    },
  };
};
