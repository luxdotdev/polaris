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
  type Attachment,
  type ApprovalDecision,
  Command,
  type CommandId,
  type RequestId,
  type RiskFinding,
  type SessionId,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, Exit, Fiber, Predicate, Stream } from "effect";
import {
  composerMode,
  type FollowUp,
  followUpCommand,
  sendQueues,
  submitCommand,
} from "./composer.ts";
import { applySessionItem, type SessionFold, summaryHead, withOlder } from "./fold.ts";
import { type OutgoingSteer, outgoingSteer, settleSteers } from "./outbox.ts";
import { newestEndedOnScreen } from "./rows.ts";
import { newCommandId, type ThreadFailure, type ThreadSource } from "./source.ts";
import type { TurnDetail } from "@polaris/protocol";

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
  /** Steers sent into the Turn in flight that the thread doesn't show yet, oldest first. */
  readonly steers: ReadonlyArray<OutgoingSteer>;
  /** Why the last send or stop failed. */
  readonly error: string | null;
  /** Pending requests whose answer is on its way to the Host. */
  readonly answering: ReadonlyArray<RequestId>;
  /** Why the last answer to a pending request failed, by request. */
  readonly requestErrors: ReadonlyMap<RequestId, string>;
  /** Older Turns than the thread holds: there may be more, they're on their way, or that's all. */
  readonly older: "more" | "loading" | "all";
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
  readonly submit: (attachments?: ReadonlyArray<Attachment>) => Promise<boolean>;
  readonly queue: (attachments?: ReadonlyArray<Attachment>) => boolean;
  /** Takes a steer that didn't land back into the composer, to send again. */
  readonly editSteer: (id: string) => void;
  readonly interrupt: () => Promise<void>;
  /** Answers a pending request; a second tap while the first is on its way does nothing. */
  readonly respond: (requestId: RequestId, decision: ApprovalDecision) => Promise<void>;
  /** Queued follow-ups or a command still on its way: the thread outlives its screen. */
  readonly busy: () => boolean;
  /** The Host's connection came back: drafts that failed to save are written again. */
  readonly reconnected: () => void;
  /** Pages in Turns older than the thread holds; does nothing while a page is on its way. */
  readonly loadOlder: () => void;
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
  steers: [],
  error: null,
  answering: [],
  requestErrors: new Map(),
  older: "more",
};

/** How many older Turns one scroll to the top brings in. */
export const OLDER_PAGE = 30;

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
  /** A follow-up taken off the queue until it succeeds or is back on it. */
  let followingUp = false;
  /** Bumped by every edit, so an acknowledgement clears only the text it sent. */
  let generation = 0;
  let findingsFiber: Fiber.Fiber<void, ThreadFailure> | null = null;
  /** Older Turns paged in so far, oldest first; a fresh Snapshot keeps them. */
  let pages: ReadonlyArray<TurnDetail> = [];
  const listeners = new Set<() => void>();
  const fibers: Array<Fiber.Fiber<void, ThreadFailure>> = [];

  const set = (patch: Partial<ThreadState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const run = <A>(effect: Effect.Effect<A, ThreadFailure>) => Effect.runPromise(effect);
  const inFlight = new Map<string, Promise<string | null>>();
  /** Per action, the command whose outcome is unknown and the id a retry of it reuses. */
  const retained = new Map<string, { readonly command: string; readonly id: CommandId }>();

  /**
   * Sends one command per action (`slot`) at a time; answers why it failed, or
   * null. A retry after a dropped connection reuses the command's id.
   */
  const send = (slot: string, command: Command): Promise<string | null> => {
    const held = inFlight.get(slot);

    if (held !== undefined) return held;
    const key = JSON.stringify(command);
    const kept = retained.get(slot);
    const id = kept?.command === key ? kept.id : newCommandId();
    retained.set(slot, { command: key, id });

    const sent = Effect.runPromise(
      source.dispatch(command, id).pipe(
        Effect.match({
          onFailure: (error) => {
            if (error.ambiguous !== true) retained.delete(slot);

            return error.message;
          },
          onSuccess: () => {
            retained.delete(slot);

            return null;
          },
        })
      )
    ).finally(() => {
      inFlight.delete(slot);
      listeners.forEach((listener) => listener());
    });

    inFlight.set(slot, sent);

    return sent;
  };

  const drafts: DraftSync = makeDraftSync({
    delayMs: options.draftDelayMs ?? DRAFT_SAVE_DELAY_MS,
    save: (id, text) => run(source.saveDraft(id, text)).catch(() => null),
    adopt: (id, text) => {
      if (id !== sessionId) return;
      generation++;
      set({ text });
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
    followingUp = true;
    set({ queued: state.queued.slice(1) });
    void send("follow-up", followUpCommand(sessionId, next)).then((error) => {
      followingUp = false;

      if (error === null) return set({});
      followUpTurns = null;
      // One publication: the registry never sees this follow-up neither queued nor sending.
      set({ queued: [next, ...state.queued], error });
    });
  };

  fibers.push(
    follow(source.session(sessionId), (item) => {
      const applied = applySessionItem(state.fold, item);

      const fold =
        applied !== null && Predicate.isTagged(item, "Snapshot")
          ? withOlder(applied, pages)
          : applied;

      if (fold === state.fold || fold === null) return;
      set({ fold, steers: settleSteers(state.steers, fold.turns) });
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
    generation++;
    set({ text, error: null });

    if (continuity !== null) drafts.edit(sessionId, text);
  };

  const clearSent = () => {
    type("");
    void drafts.flush(sessionId);
  };

  const queue = (attachments: ReadonlyArray<Attachment> = []) => {
    const text = state.text.trim();

    if (text === "") return false;
    set({ queued: [...state.queued, { text, attachments }] });
    clearSent();

    return true;
  };

  /** Shows the steer in the thread at once; it stays there until it lands or fails. */
  const steer = async (fold: SessionFold, command: Command) => {
    const turnId = lastTurnOf(fold)?.id;

    if (turnId === undefined) return false;
    const entry = outgoingSteer(fold.turns, turnId, state.text);
    set({ steers: [...state.steers, entry] });
    clearSent();
    const error = await send(`steer:${entry.id}`, command);

    const steers = state.steers.map((held): OutgoingSteer =>
      held.id === entry.id ? { ...held, status: error === null ? "sent" : "failed", error } : held
    );

    set({ steers: settleSteers(steers, state.fold?.turns ?? []) });

    return true;
  };

  const editSteer = (id: string) => {
    const held = state.steers.find((entry) => entry.id === id);

    if (held === undefined || held.status !== "failed") return;
    set({ steers: state.steers.filter((entry) => entry !== held) });
    type(state.text.trim() === "" ? held.text : `${state.text.trimEnd()}\n${held.text}`);
  };

  const submit = async (attachments: ReadonlyArray<Attachment> = []) => {
    const ids = attachments.map((attachment) => attachment.id);
    const fold = state.fold;

    if (fold === null) return false;

    const mode = composerMode({
      state: fold.session.state,
      lastTurn: lastTurnOf(fold)?.status ?? null,
      pendingApprovals: fold.pendingApprovals,
      canSteer: source.canSteer,
    });

    if (sendQueues(mode, ids)) return queue(attachments);
    const command = submitCommand(mode, sessionId, state.text, ids);

    // A Send already on its way carries its own attachments, not chips added since.
    if (command === null || inFlight.has("composer")) return false;

    if (mode.kind === "steer") return steer(fold, command);

    const sentAt = generation;
    const error = await send("composer", command);

    if (error !== null) set({ error });
    else if (generation === sentAt) clearSent();

    return error === null;
  };

  const interrupt = async () => {
    const error = await send("interrupt", Command.cases.Interrupt.make({ sessionId }));

    if (error !== null) set({ error });
  };

  const respond = async (requestId: RequestId, decision: ApprovalDecision) => {
    const slot = `request:${requestId}`;
    const first = !inFlight.has(slot);

    const sending = send(
      slot,
      Command.cases.RespondToApproval.make({ sessionId, requestId, decision })
    );

    if (!first) return void (await sending);
    const errors = new Map(state.requestErrors);
    errors.delete(requestId);
    set({ answering: [...state.answering, requestId], requestErrors: errors });
    const error = await sending;
    const after = new Map(state.requestErrors);

    if (error !== null) after.set(requestId, error);
    set({ answering: state.answering.filter((id) => id !== requestId), requestErrors: after });
  };

  const loadOlder = () => {
    const first = state.fold?.turns[0]?.turn.index ?? 0;

    if (state.older !== "more" || state.fold === null) return;

    if (first === 0) return set({ older: "all" });
    set({ older: "loading" });

    const paged = source.olderTurns(sessionId, first, OLDER_PAGE).pipe(
      Effect.match({
        // A dropped connection tries again on the next scroll; a refusal is the end.
        onFailure: (error) => set({ older: error.ambiguous === true ? "more" : "all" }),
        onSuccess: (page) => {
          if (page === null) return set({ older: "all" });
          pages = [...page.turns, ...pages];

          set({
            fold: state.fold === null ? null : withOlder(state.fold, page.turns),
            older: page.hasMore ? "more" : "all",
          });
        },
      })
    );

    void Effect.runPromise(paged);
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
    editSteer,
    interrupt,
    respond,
    busy: () =>
      followingUp ||
      state.queued.length > 0 ||
      inFlight.size > 0 ||
      state.steers.some((entry) => entry.status !== "failed"),
    seen,
    loadOlder,
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
