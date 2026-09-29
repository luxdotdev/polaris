/**
 * Supervises each Agent Session's Harness: opens it, hands it Turns, and maps
 * the `HarnessEvent`s it (or a followed terminal UI) reports to domain events
 * and session machine inputs.
 */
import {
  type AgentSession,
  ApprovalRequest,
  type Attachment,
  DomainEvent,
  NotFound,
  type SessionId,
  Subagent,
  type TurnId,
  Worktree,
} from "@polaris/protocol";
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect";
import { type HarnessError, HarnessEvent } from "../harness/HarnessDriver.ts";
import type { ServiceError } from "../services.ts";
import { LiveItem } from "../store/EventStore.ts";
import { worktreeIdFor } from "./decider.ts";
import { finalReply, forkPreamble } from "./fork.ts";
import { EngineRuntime, type EventSource, type LiveHarness, type Progress } from "./runtime.ts";

type HarnessEventOf<Tag extends HarnessEvent["_tag"]> = Extract<HarnessEvent, { _tag: Tag }>;

export interface TurnToRun {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

const make = (rt: EngineRuntime["Service"]): Supervisor["Service"] => {
  const { store, live, progress } = rt;

  const openHarness = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const existing = live.get(sessionId);

      if (existing !== undefined) return existing;
      const model = yield* store.model;
      const record = model.sessions.get(sessionId);

      if (record === undefined) {
        return yield* new NotFound({ what: "session", id: sessionId });
      }

      const driver = yield* rt.registry.get(record.session.harness);
      const scope = yield* Scope.make();

      const session = yield* driver
        .open({
          sessionId,
          cwd: record.session.cwd,
          permissionMode: record.session.permissionMode,
          model: record.session.model,
          effort: record.session.effort,
          resumeCursor: record.session.harnessCursor,
        })
        .pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void))
        );

      const entry: LiveHarness = { driver, session, scope, consumer: null, stopping: false };
      live.set(sessionId, entry);
      entry.consumer = yield* Effect.forkIn(consume(sessionId, entry), rt.engineScope);

      return entry;
    });

  const consume = (sessionId: SessionId, entry: LiveHarness): Effect.Effect<void> =>
    entry.session.events.pipe(
      Stream.runForEach((event) =>
        onHarnessEvent(sessionId, entry, event).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`handling ${event._tag} for ${sessionId} failed`, cause)
          )
        )
      ),
      // A stream that ends without `Exited` is a clean exit.
      Effect.andThen(
        Effect.suspend(() =>
          entry.stopping
            ? Effect.void
            : recorded(sessionId, entry, (at) => onExited(sessionId, entry, null, at)).pipe(
                Effect.catchCause((cause) => Effect.logError("handling exit failed", cause))
              )
        )
      )
    );

  const isDelta = HarnessEvent.$is("ItemDelta");

  const onHarnessEvent = (
    sessionId: SessionId,
    entry: EventSource,
    event: HarnessEvent
  ): Effect.Effect<void, ServiceError> =>
    // Deltas are most of what a Harness emits: publish them without the rest.
    isDelta(event)
      ? Effect.suspend(() =>
          entry.stopping
            ? Effect.void
            : store.publishEphemeral(
                LiveItem.Delta({
                  sessionId,
                  turnId: event.turnId,
                  itemId: event.itemId,
                  field: event.field,
                  text: event.text,
                  subagentId: event.subagentId ?? null,
                })
              )
        )
      : recorded(sessionId, entry, (at) => onHarnessRecord(sessionId, entry, event, at));

  /** Runs `handle` with the time, unless the source is being stopped on purpose. */
  const recorded = (
    sessionId: SessionId,
    entry: EventSource,
    handle: (at: string) => Effect.Effect<void, ServiceError>
  ) =>
    Effect.gen(function* () {
      if (entry.stopping) return;
      yield* handle(yield* rt.now);
    });

  const onHarnessRecord = (
    sessionId: SessionId,
    entry: EventSource,
    event: HarnessEvent,
    at: string
  ): Effect.Effect<void, ServiceError> =>
    HarnessEvent.$match(event, {
      CursorAssigned: (e) =>
        rt.recordFor(sessionId, (record) =>
          record.session.harnessCursor === e.cursor
            ? []
            : [
                DomainEvent.cases.SessionCursorUpdated.make({
                  sessionId,
                  harnessCursor: e.cursor,
                }),
              ]
        ),
      TurnStarted: (e) =>
        // Turns Polaris sent are already recorded; others (e.g. typed in a co-attached TUI) are new.
        rt
          .signal(sessionId, {
            type: "harness.turnStarted",
            turnId: e.turnId,
            prompt: e.prompt ?? "",
            at,
          })
          .pipe(Effect.andThen(rt.cancelIdle(sessionId))),
      ItemDelta: () => Effect.void, // handled by onHarnessEvent
      ItemUpdated: (e) => onItemUpdated(sessionId, e),
      ItemCompleted: (e) =>
        Effect.suspend(() => {
          progress.get(sessionId)?.delete(e.item.id);

          return rt.recordFor(sessionId, () => [
            DomainEvent.cases.TurnItemCompleted.make({
              sessionId,
              turnId: e.turnId,
              item: e.item,
              subagentId: e.subagentId ?? null,
            }),
          ]);
        }),
      ApprovalRequested: (e) =>
        rt.signal(sessionId, {
          type: "harness.approvalRequested",
          request: new ApprovalRequest({
            id: e.requestId,
            sessionId,
            turnId: e.turnId,
            kind: e.kind,
            title: e.title,
            detail: e.detail,
            options: [...e.options],
            openedAt: at,
          }),
        }),
      ApprovalWithdrawn: (e) =>
        rt.signal(sessionId, { type: "harness.approvalWithdrawn", requestId: e.requestId }),
      TurnEnded: (e) => onTurnEnded(sessionId, e, at),
      SubagentStarted: (e) =>
        rt.signal(sessionId, {
          type: "harness.subagentStarted",
          subagent: new Subagent({
            id: e.subagentId,
            sessionId,
            turnId: e.turnId,
            parentItemId: e.parentItemId,
            title: e.title,
            agent: e.agent,
            model: e.model,
            status: "working",
            startedAt: at,
            endedAt: null,
          }),
        }),
      SubagentEnded: (e) =>
        rt.signal(sessionId, {
          type: "harness.subagentEnded",
          subagentId: e.subagentId,
          status: e.status,
          at,
        }),
      TitleSuggested: (e) =>
        rt.recordFor(sessionId, (record) =>
          record.titleLocked || record.session.title === e.title
            ? []
            : [DomainEvent.cases.SessionRenamed.make({ sessionId, title: e.title })]
        ),
      WorktreeCreated: (e) => onWorktreeCreated(sessionId, e.path),
      Exited: (e) => onExited(sessionId, entry, e.error, at),
    }).pipe(Effect.asVoid);

  const onItemUpdated = (sessionId: SessionId, event: HarnessEventOf<"ItemUpdated">) =>
    Effect.suspend(() => {
      const items = progress.get(sessionId) ?? new Map<string, Progress>();
      const subagentId = event.subagentId ?? null;
      items.set(event.item.id, { turnId: event.turnId, item: event.item, subagentId });
      progress.set(sessionId, items);

      return store.publishEphemeral(
        LiveItem.ItemProgress({ sessionId, turnId: event.turnId, item: event.item, subagentId })
      );
    });

  const onTurnEnded = (sessionId: SessionId, event: HarnessEventOf<"TurnEnded">, at: string) =>
    Effect.gen(function* () {
      rt.dropProgress(sessionId, event.turnId);
      const after = yield* rt.capture(sessionId, event.turnId, "after");
      yield* rt.signal(sessionId, {
        type: "harness.turnEnded",
        turnId: event.turnId,
        status: event.status,
        error: event.error,
        checkpoint: after,
        at,
      });
    });

  const onWorktreeCreated = (sessionId: SessionId, path: string) =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const record = model.sessions.get(sessionId);
      const workspace = record && model.workspaces.get(record.session.workspaceId);

      if (workspace === undefined) return;

      const listed = yield* rt.worktrees
        .list(workspace.path)
        .pipe(Effect.catch(() => Effect.succeed([])));

      const info = listed.find((w) => w.path === path);
      yield* rt.recordFor(sessionId, () => [
        DomainEvent.cases.WorktreeDetected.make({
          worktree: new Worktree({
            id: worktreeIdFor(path),
            workspaceId: workspace.id,
            path,
            branch: info?.branch ?? null,
            head: info?.head ?? "",
            createdBySessionId: sessionId,
            isMain: info?.isMain ?? false,
          }),
        }),
      ]);
    });

  const onExited = (sessionId: SessionId, entry: EventSource, error: string | null, at: string) =>
    Effect.gen(function* () {
      entry.stopping = true;

      if (live.get(sessionId) === entry) live.delete(sessionId);
      rt.dropProgress(sessionId);
      yield* rt.cancelIdle(sessionId);
      yield* Scope.close(entry.scope, Exit.void);
      yield* rt.signal(sessionId, { type: "harness.exited", error, at });
    });

  const runTurn = ({ sessionId, turnId, prompt, attachments }: TurnToRun) =>
    Effect.gen(function* () {
      yield* rt.cancelIdle(sessionId);
      const model = yield* store.model;
      const turn = model.sessions.get(sessionId)?.turns.find((t) => t.id === turnId);

      if (turn === undefined || turn.status !== "working") return;

      if (turn.checkpointBefore === null) yield* recordBefore(sessionId, turnId);

      // Before opening: a Harness may report its cursor as soon as it opens.
      const session = (yield* store.model).sessions.get(sessionId)?.session;

      const input =
        session !== undefined && session.parentSessionId !== null && session.harnessCursor === null
          ? yield* withForkContext(session, session.parentSessionId, prompt)
          : prompt;

      const entry = yield* openHarness(sessionId);
      yield* rt.signal(sessionId, { type: "harness.opened" });
      yield* entry.session.sendTurn({
        turnId,
        prompt: input,
        attachments,
        model: turn.model,
        effort: turn.effort,
      });
    }).pipe(Effect.catch((error) => rt.failSession(sessionId, error.message)));

  const recordBefore = (sessionId: SessionId, turnId: TurnId) =>
    Effect.gen(function* () {
      const before = yield* rt.capture(sessionId, turnId, "before");

      if (before === null) return;
      yield* rt.recordFor(sessionId, () => [
        DomainEvent.cases.CheckpointRecorded.make({
          sessionId,
          turnId,
          ref: before.ref,
          commit: before.commit,
        }),
      ]);
    });

  /** A Fork's Harness starts fresh: prefix its first Turn with the parent's conversation (fork.ts). */
  const withForkContext = (session: AgentSession, parentId: SessionId, prompt: string) =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const parent = model.sessions.get(parentId);
      const turns = yield* store.readTurns({ sessionId: parentId, beforeIndex: null, limit: null });
      const at = turns.findIndex((t) => t.id === session.forkedFromTurnId);
      const included = at === -1 ? turns : turns.slice(0, at + 1);

      const items = yield* store.readTurnItems({
        turnIds: included.map((t) => t.id),
        upTo: model.sequence,
      });

      return forkPreamble({
        parentTitle: parent?.session.title ?? parentId,
        ownWorktree:
          session.worktreeId !== null && session.worktreeId !== parent?.session.worktreeId,
        turns: included.map((t) => ({ prompt: t.prompt, reply: finalReply(items.get(t.id)) })),
        prompt,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.as(Effect.logWarning(`fork context for ${session.id}: ${error.message}`), prompt)
      )
    );

  return { openHarness, onHarnessEvent, runTurn };
};

export class Supervisor extends Context.Service<
  Supervisor,
  {
    /** The session's running Harness, opened (resuming its cursor) if needed. */
    readonly openHarness: (
      sessionId: SessionId
    ) => Effect.Effect<LiveHarness, NotFound | ServiceError | HarnessError>;
    /** Handle one event a Harness or a followed terminal UI reported. */
    readonly onHarnessEvent: (
      sessionId: SessionId,
      entry: EventSource,
      event: HarnessEvent
    ) => Effect.Effect<void, ServiceError>;
    /** Capture the before-checkpoint, make sure the Harness runs, and hand it the Turn. */
    readonly runTurn: (turn: TurnToRun) => Effect.Effect<void, ServiceError>;
  }
>()("polaris/daemon/engine/Supervisor") {
  static readonly layer = Layer.effect(
    Supervisor,
    Effect.gen(function* () {
      return make(yield* EngineRuntime);
    })
  );
}
