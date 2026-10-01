/**
 * One open Agent Session in the renderer: the session, its Turns with their
 * completed items, pending approvals, and the live state of items still in
 * progress (`Delta` text and `ItemProgress`), folded from the session feed.
 */
import type {
  Sequence,
  ApprovalRequest,
  DomainEvent,
  EventEnvelope,
  SessionStreamItem,
  Subagent,
  Turn,
  TurnItem,
} from "@polaris/protocol";
import { Match } from "effect";
import type { SessionData } from "./plain.ts";

/** An item still in progress: the latest `ItemProgress`, plus text streamed as deltas. */
export interface LiveItem {
  readonly item: TurnItem | null;
  readonly text: string;
  readonly output: string;
}

/** A Subagent the Turn spawned, with its own items (completed and in progress). */
export interface SubagentView {
  readonly subagent: Subagent;
  readonly items: ReadonlyArray<TurnItem>;
  readonly live: ReadonlyMap<string, LiveItem>;
}

export interface TurnView {
  readonly turn: Turn;
  readonly items: ReadonlyArray<TurnItem>;
  /** Keyed by item id; an item leaves when its `TurnItemCompleted` arrives. */
  readonly live: ReadonlyMap<string, LiveItem>;
  /** The Subagents it spawned, in the order they started; their items never mix with the Turn's. */
  readonly subagents: ReadonlyArray<SubagentView>;
}

export interface SessionModel {
  readonly sequence: Sequence;
  readonly synchronized: boolean;
  readonly session: SessionData | null;
  readonly turns: ReadonlyArray<TurnView>;
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
}

export const emptySessionModel: SessionModel = {
  // SAFETY: sequences start at 1, so 0 precedes every real one.
  sequence: 0 as Sequence,
  synchronized: false,
  session: null,
  turns: [],
  pendingApprovals: [],
};

const noLive: ReadonlyMap<string, LiveItem> = new Map();

const updateTurn = (
  model: SessionModel,
  turnId: string,
  change: (view: TurnView) => TurnView
): SessionModel => {
  const at = model.turns.findIndex((t) => t.turn.id === turnId);

  if (at === -1) return model;

  return { ...model, turns: model.turns.map((t, i) => (i === at ? change(t) : t)) };
};

const upsertTurn = (model: SessionModel, turn: Turn): SessionModel => {
  const at = model.turns.findIndex((t) => t.turn.id === turn.id);

  if (at !== -1) return updateTurn(model, turn.id, (view) => ({ ...view, turn }));

  const turns = [...model.turns, { turn, items: [], live: noLive, subagents: [] }].sort(
    (a, b) => a.turn.index - b.turn.index
  );

  return { ...model, turns };
};

const patchSession = (model: SessionModel, fields: Partial<SessionData>): SessionModel =>
  model.session === null ? model : { ...model, session: { ...model.session, ...fields } };

const withoutRequest = (model: SessionModel, requestId: string): SessionModel => ({
  ...model,
  pendingApprovals: model.pendingApprovals.filter((r) => r.id !== requestId),
});

/** Turn or Subagent: what holds items and their live progress. */
interface Holder {
  readonly items: ReadonlyArray<TurnItem>;
  readonly live: ReadonlyMap<string, LiveItem>;
}

const completeItem = <H extends Holder>(view: H, item: TurnItem): H => {
  const live = new Map(view.live);

  live.delete(item.id);
  const at = view.items.findIndex((i) => i.id === item.id);
  const items = at === -1 ? [...view.items, item] : view.items.map((i, n) => (n === at ? item : i));

  return { ...view, items, live };
};

/** Changes one Subagent of a Turn; a no-op when the Turn or the Subagent isn't known. */
const updateSubagent = (
  model: SessionModel,
  turnId: string,
  subagentId: string,
  change: (view: SubagentView) => SubagentView
): SessionModel =>
  updateTurn(model, turnId, (view) => {
    const at = view.subagents.findIndex((s) => s.subagent.id === subagentId);

    if (at === -1) return view;

    return { ...view, subagents: view.subagents.map((s, i) => (i === at ? change(s) : s)) };
  });

/** A Subagent started (or was restated): added to its Turn, or its record replaced. */
const upsertSubagent = (model: SessionModel, subagent: Subagent): SessionModel =>
  updateTurn(model, subagent.turnId, (view) =>
    view.subagents.some((s) => s.subagent.id === subagent.id)
      ? {
          ...view,
          subagents: view.subagents.map((s) =>
            s.subagent.id === subagent.id ? { ...s, subagent } : s
          ),
        }
      : { ...view, subagents: [...view.subagents, { subagent, items: [], live: noLive }] }
  );

type Fold = (model: SessionModel) => SessionModel;

const same: Fold = (model) => model;

const fold = (event: DomainEvent): Fold =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      WorkspaceRegistered: () => same,
      WorkspaceUpdated: () => same,
      WorkspaceRemoved: () => same,
      WorktreeDetected: () => same,
      WorktreeRemoved: () => same,
      SessionCreated:
        ({ session }): Fold =>
        (m) => ({ ...m, session }),
      SessionStateChanged:
        ({ state, reason }): Fold =>
        (m) =>
          patchSession(m, {
            state,
            lastError: state === "failed" ? reason : (m.session?.lastError ?? null),
          }),
      SessionRenamed:
        ({ title }): Fold =>
        (m) =>
          patchSession(m, { title }),
      SessionCursorUpdated:
        ({ harnessCursor }): Fold =>
        (m) =>
          patchSession(m, { harnessCursor }),
      SessionModelChanged:
        ({ model, effort }): Fold =>
        (m) =>
          patchSession(m, { model, effort }),
      SessionPermissionModeChanged:
        ({ permissionMode }): Fold =>
        (m) =>
          patchSession(m, { permissionMode }),
      SessionContextUsed:
        ({ usage }): Fold =>
        (m) =>
          patchSession(m, { contextUsage: usage }),
      TurnStarted:
        ({ turn }): Fold =>
        (m) =>
          patchSession(upsertTurn(m, turn), {
            turnCount: Math.max(m.session?.turnCount ?? 0, turn.index + 1),
          }),
      TurnEnded:
        ({ turn }): Fold =>
        (m) =>
          updateTurn(upsertTurn(m, turn), turn.id, (view) => ({ ...view, live: noLive })),
      TurnItemCompleted:
        ({ turnId, item, subagentId }): Fold =>
        (m) =>
          // A Subagent's own items belong to it, never to the Turn.
          subagentId === null
            ? updateTurn(m, turnId, (view) => completeItem(view, item))
            : updateSubagent(m, turnId, subagentId, (view) => completeItem(view, item)),
      SubagentStarted:
        ({ subagent }): Fold =>
        (m) =>
          upsertSubagent(m, subagent),
      SubagentEnded:
        ({ subagent }): Fold =>
        (m) =>
          updateSubagent(upsertSubagent(m, subagent), subagent.turnId, subagent.id, (view) => ({
            ...view,
            live: noLive,
          })),
      CheckpointRecorded: () => same,
      ApprovalRequested:
        ({ request }): Fold =>
        (m) => ({
          ...m,
          pendingApprovals: [...withoutRequest(m, request.id).pendingApprovals, request],
        }),
      ApprovalResolved:
        ({ requestId }): Fold =>
        (m) =>
          withoutRequest(m, requestId),
      ApprovalWithdrawn:
        ({ requestId }): Fold =>
        (m) =>
          withoutRequest(m, requestId),
    })
  );

const applyEnvelope = (model: SessionModel, envelope: EventEnvelope): SessionModel => {
  if (envelope.sequence <= model.sequence) return model;

  return { ...fold(envelope.event)(model), sequence: envelope.sequence };
};

const liveOf = (view: Holder, itemId: string): LiveItem =>
  view.live.get(itemId) ?? { item: null, text: "", output: "" };

const withLive = <H extends Holder>(view: H, itemId: string, live: LiveItem): H => {
  // A delta can trail its item's completion by a frame; never resurrect it.
  if (view.items.some((i) => i.id === itemId)) return view;

  return { ...view, live: new Map(view.live).set(itemId, live) };
};

/** Applies a change to the Turn, or to its Subagent when the item is the Subagent's own. */
const onHolder = (
  model: SessionModel,
  turnId: string,
  subagentId: string | null,
  change: <H extends Holder>(holder: H) => H
): SessionModel =>
  subagentId === null
    ? updateTurn(model, turnId, (view) => change(view))
    : updateSubagent(model, turnId, subagentId, (view) => change(view));

export const applySessionItem = (model: SessionModel, item: SessionStreamItem): SessionModel =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: (snapshot): SessionModel => ({
        sequence: snapshot.sequence,
        synchronized: false,
        session: snapshot.session,
        turns: snapshot.turns.map((detail) => ({
          turn: detail.turn,
          items: detail.items,
          live: noLive,
          subagents: detail.subagents.map(({ subagent, items }) => ({
            subagent,
            items,
            live: noLive,
          })),
        })),
        pendingApprovals: snapshot.pendingApprovals,
      }),
      Event: ({ envelope }) => applyEnvelope(model, envelope),
      Delta: ({ turnId, itemId, field, text, subagentId }) =>
        onHolder(model, turnId, subagentId, (view) => {
          const live = liveOf(view, itemId);

          return withLive(view, itemId, { ...live, [field]: live[field] + text });
        }),
      ItemProgress: ({ turnId, item: progress, subagentId }) =>
        onHolder(model, turnId, subagentId, (view) =>
          withLive(view, progress.id, { ...liveOf(view, progress.id), item: progress })
        ),
      Synchronized: (): SessionModel => ({ ...model, synchronized: true }),
    })
  );

export const applySessionItems = (model: SessionModel, items: ReadonlyArray<SessionStreamItem>) =>
  items.reduce(applySessionItem, model);
