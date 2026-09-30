/**
 * The session view's own UI state, per Agent Session: which earlier Turns are
 * unfolded, whether Output is open and which Turn it shows, and the composer's draft. It outlives the
 * view, so switching back to a session paints it as it was left.
 */
import type { AttachmentId } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Outgoing } from "./model/outbox.ts";

export interface StagedAttachment {
  readonly id: AttachmentId;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface SessionUi {
  readonly unfolded: ReadonlySet<string>;
  /** The Turn whose diff Output shows; null follows the latest Turn. */
  readonly diffTurnId: string | null;
  /** Output open as a panel; a new session starts with the collapsed rail. */
  readonly outputOpen: boolean;
  /** The Turn whose first edit last opened Output: each Turn opens it at most once. */
  readonly autoOpenedTurn: string | null;
  readonly draft: string;
  readonly attachments: ReadonlyArray<StagedAttachment>;
  /** Steers and queued follow-ups (⌘↵) not in the conversation yet (`model/outbox.ts`). */
  readonly outbox: ReadonlyArray<Outgoing<StagedAttachment>>;
}

const EMPTY: SessionUi = {
  unfolded: new Set(),
  diffTurnId: null,
  outputOpen: false,
  autoOpenedTurn: null,
  draft: "",
  attachments: [],
  outbox: [],
};

type UiState = Readonly<Record<string, SessionUi>>;

const store = createStore<UiState>(() => ({}));

export const uiKey = (hostKey: string, sessionId: string) => `${hostKey}\u0000${sessionId}`;

export const useSessionUi = (key: string): SessionUi => useStore(store, (s) => s[key] ?? EMPTY);

export const patchSessionUi = (key: string, patch: (ui: SessionUi) => Partial<SessionUi>) =>
  store.setState((s) => {
    const current = s[key] ?? EMPTY;

    return { ...s, [key]: { ...current, ...patch(current) } };
  });

export const toggleUnfolded = (key: string, turnId: string) =>
  patchSessionUi(key, ({ unfolded }) => {
    const next = new Set(unfolded);

    if (!next.delete(turnId)) next.add(turnId);

    return { unfolded: next };
  });

export const showTurnDiff = (key: string, turnId: string | null) =>
  patchSessionUi(key, () => ({ diffTurnId: turnId }));

/** Change one outbox entry; a no-op once it's gone. */
export const patchOutgoing = (
  key: string,
  id: string,
  patch: (entry: Outgoing<StagedAttachment>) => Partial<Outgoing<StagedAttachment>>
) =>
  patchSessionUi(key, ({ outbox }) => ({
    outbox: outbox.map((e) => (e.id === id ? { ...e, ...patch(e) } : e)),
  }));

export const dropOutgoing = (key: string, id: string) =>
  patchSessionUi(key, ({ outbox }) => ({ outbox: outbox.filter((e) => e.id !== id) }));

export const setOutputOpen = (key: string, open: boolean) =>
  patchSessionUi(key, () => ({ outputOpen: open }));

/** A Turn's first edit opens Output, unless this Turn already did (the user may have closed it). */
export const openForEdit = (key: string, turnId: string) => {
  if ((store.getState()[key] ?? EMPTY).autoOpenedTurn === turnId) return;
  patchSessionUi(key, () => ({ outputOpen: true, autoOpenedTurn: turnId }));
};

export const getSessionUi = (key: string): SessionUi => store.getState()[key] ?? EMPTY;
