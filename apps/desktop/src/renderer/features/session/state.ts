/**
 * The session view's own UI state, per Agent Session: which earlier Turns are
 * unfolded, which Turn Output shows, and the composer's draft. It outlives the
 * view, so switching back to a session paints it as it was left.
 */
import type { AttachmentId } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

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
  readonly draft: string;
  readonly attachments: ReadonlyArray<StagedAttachment>;
}

const EMPTY: SessionUi = {
  unfolded: new Set(),
  diffTurnId: null,
  draft: "",
  attachments: [],
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
