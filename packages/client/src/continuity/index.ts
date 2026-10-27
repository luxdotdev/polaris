/**
 * Continuity on a Client (ENG-458): folds `continuity.watch` into each
 * session's read position and draft, and syncs the composer's draft with
 * debounced `continuity.saveDraft` writes. Plain TypeScript, so a renderer can
 * run it next to the composer.
 */
import {
  type ComposerDraft,
  ContinuityItem,
  type ReadPosition,
  type SessionId,
} from "@polaris/protocol";

export interface ContinuityState {
  readonly reads: ReadonlyMap<SessionId, ReadPosition>;
  readonly drafts: ReadonlyMap<SessionId, ComposerDraft>;
}

export const emptyContinuity: ContinuityState = { reads: new Map(), drafts: new Map() };

/** A Snapshot replaces everything; a change only lands when it is newer than what is held. */
export const applyContinuity = (state: ContinuityState, item: ContinuityItem): ContinuityState =>
  ContinuityItem.match(item, {
    Snapshot: ({ reads, drafts }) => ({
      reads: new Map(reads.map((r) => [r.sessionId, r])),
      drafts: new Map(drafts.map((d) => [d.sessionId, d])),
    }),
    Read: ({ position }) => {
      const held = state.reads.get(position.sessionId);

      if (held !== undefined && held.turnIndex >= position.turnIndex) return state;

      return { ...state, reads: new Map(state.reads).set(position.sessionId, position) };
    },
    Draft: ({ draft }) => {
      const held = state.drafts.get(draft.sessionId);

      if (held !== undefined && held.revision >= draft.revision) return state;

      return { ...state, drafts: new Map(state.drafts).set(draft.sessionId, draft) };
    },
  });

/** How long typing must pause before the draft is written to the Host. */
export const DRAFT_SAVE_DELAY_MS = 500;

/** `saved` once the Host holds what was typed; `unsaved` after a write failed. */
export type DraftStatus = "saved" | "saving" | "unsaved";

export interface DraftSyncOptions {
  /** Writes the draft; null when the write failed. */
  readonly save: (sessionId: SessionId, text: string) => Promise<ComposerDraft | null>;
  /** Another Client's draft replaces the composer's text. */
  readonly adopt: (sessionId: SessionId, text: string) => void;
  readonly status?: (sessionId: SessionId, status: DraftStatus) => void;
  readonly delayMs?: number;
  /** Runs `run` after `ms`; answers a cancel. Tests pass a manual clock. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
}

interface Slot {
  /** The highest revision this Client has written or adopted. */
  revision: number;
  /** Typed text not yet written. */
  pending: string | null;
  cancel: (() => void) | null;
  writing: number;
  /** A newer draft that came while this Client was typing or writing. */
  waiting: ComposerDraft | null;
}

const timeout = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);

  return () => clearTimeout(timer);
};

export interface DraftSync {
  /** The composer's text changed here. */
  readonly edit: (sessionId: SessionId, text: string) => void;
  /** A draft from the Host (a Snapshot's or a change), to adopt unless typing here is newer. */
  readonly receive: (draft: ComposerDraft) => void;
  /** Writes a pending draft now (before sending, or when the window closes). */
  readonly flush: (sessionId: SessionId) => Promise<void>;
  /** Cancels pending writes. */
  readonly dispose: () => void;
}

/**
 * Last writer wins on the Host. While this Client has typing it hasn't written,
 * or a write in flight, a remote draft waits; it is adopted afterwards only if
 * it is still newer than this Client's own write.
 */
export const makeDraftSync = (options: DraftSyncOptions): DraftSync => {
  const slots = new Map<SessionId, Slot>();
  const schedule = options.schedule ?? timeout;
  const delay = options.delayMs ?? DRAFT_SAVE_DELAY_MS;

  const slot = (sessionId: SessionId): Slot => {
    const held = slots.get(sessionId);

    if (held !== undefined) return held;
    const fresh: Slot = { revision: 0, pending: null, cancel: null, writing: 0, waiting: null };
    slots.set(sessionId, fresh);

    return fresh;
  };

  const adoptWaiting = (sessionId: SessionId, s: Slot) => {
    const waiting = s.waiting;

    if (waiting === null || s.pending !== null || s.writing > 0) return;
    s.waiting = null;

    if (waiting.revision <= s.revision) return;
    s.revision = waiting.revision;
    options.adopt(sessionId, waiting.text);
  };

  const write = async (sessionId: SessionId) => {
    const s = slot(sessionId);
    s.cancel?.();
    s.cancel = null;
    const text = s.pending;

    if (text === null) return;
    s.pending = null;
    s.writing++;
    options.status?.(sessionId, "saving");
    const saved = await options.save(sessionId, text).catch(() => null);
    s.writing--;

    if (saved === null) {
      // Kept for the next edit or flush to write again.
      s.pending ??= text;
      options.status?.(sessionId, "unsaved");

      return;
    }

    s.revision = Math.max(s.revision, saved.revision);

    if (s.pending === null && s.writing === 0) options.status?.(sessionId, "saved");
    adoptWaiting(sessionId, s);
  };

  return {
    edit: (sessionId, text) => {
      const s = slot(sessionId);
      s.pending = text;
      s.cancel?.();
      s.cancel = schedule(() => void write(sessionId), delay);
    },
    receive: (draft) => {
      const s = slot(draft.sessionId);

      if (draft.revision <= s.revision) return;

      if (draft.revision > (s.waiting?.revision ?? 0)) s.waiting = draft;
      adoptWaiting(draft.sessionId, s);
    },
    flush: (sessionId) => write(sessionId),
    dispose: () => {
      for (const s of slots.values()) s.cancel?.();
      slots.clear();
    },
  };
};
