/**
 * Comment state in the renderer, per Review subject: the open composer, the pull request's
 * detail as the diff's thread rows read it, and an Agent Session's draft feedback batch
 * (kept in `localStorage` until sent, bounded to the latest 30 sessions).
 */
import type { RiskFindingId } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PullDetailView, PullRef } from "../../../../shared/github.ts";
import { type DraftBatch, emptyBatch } from "../model/feedback.ts";

/** Where the composer opens: a line range and the code it quotes. */
export interface ComposerAnchor {
  readonly path: string;
  readonly side: "new" | "old";
  readonly start: number;
  readonly end: number;
  readonly code: string;
}

export interface ComposerState {
  readonly anchor: ComposerAnchor;
  readonly text: string;
  /** The finding it answers ("Comment on this", or "Link a finding"). */
  readonly findingId: RiskFindingId | null;
  /** Moving an outdated draft here: the comment to delete once the new one is added. */
  readonly moving: string | null;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface PullComments {
  readonly pull: PullRef;
  readonly pullId: string;
  /** The checkout's head: new threads are written on the commit the diff shows. */
  readonly commitOid: string | null;
  readonly detail: PullDetailView | null;
}

export interface SessionComments {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly nextTurn: number;
}

export interface CommentsState {
  readonly composers: Readonly<Record<string, ComposerState>>;
  readonly pulls: Readonly<Record<string, PullComments>>;
  readonly sessions: Readonly<Record<string, SessionComments>>;
  readonly batches: Readonly<Record<string, DraftBatch>>;
}

const KEY = "polaris.review.feedback.v1";

const MAX_BATCHES = 30;

const LineRange = Schema.Struct({
  start: Schema.Int,
  end: Schema.Int,
  side: Schema.Literals(["new", "old"]),
});

const Stored = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      message: Schema.String,
      comments: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          path: Schema.String,
          lines: LineRange,
          code: Schema.String,
          note: Schema.String,
          findingId: Schema.NullOr(Schema.String),
        })
      ),
    })
  )
);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readBatches = (): Record<string, DraftBatch> => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    if (raw === null) return {};

    // SAFETY: finding ids are branded strings; stored ones came from the Host's summaries.
    return Option.getOrElse(Schema.decodeUnknownOption(Stored)(raw), () => ({})) as Record<
      string,
      DraftBatch
    >;
  } catch {
    return {};
  }
};

const writeBatches = (batches: Readonly<Record<string, DraftBatch>>) => {
  const kept = Object.entries(batches)
    .filter(([, b]) => b.comments.length > 0 || b.message.trim() !== "")
    .slice(-MAX_BATCHES);

  try {
    storage()?.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or off: the drafts last for this launch.
  }
};

export const commentsStore = createStore<CommentsState>(() => ({
  composers: {},
  pulls: {},
  sessions: {},
  batches: readBatches(),
}));

export const useComments = <A>(select: (state: CommentsState) => A): A =>
  useStore(commentsStore, select);

export const composerOf = (subjectKey: string) => commentsStore.getState().composers[subjectKey];

export const setComposer = (subjectKey: string, composer: ComposerState | null) =>
  commentsStore.setState((s) => {
    const composers = { ...s.composers };

    if (composer === null) delete composers[subjectKey];
    else composers[subjectKey] = composer;

    return { composers };
  });

export const patchComposer = (subjectKey: string, patch: Partial<ComposerState>) => {
  const current = composerOf(subjectKey);

  if (current !== undefined) setComposer(subjectKey, { ...current, ...patch });
};

/** Opens the composer at `anchor`, keeping the text when it is already open there. */
export const openComposer = (
  subjectKey: string,
  anchor: ComposerAnchor,
  seed: {
    readonly text?: string;
    readonly findingId?: RiskFindingId | null;
    readonly moving?: string | null;
  } = {}
) => {
  const current = composerOf(subjectKey);

  const same =
    current !== undefined &&
    current.anchor.path === anchor.path &&
    current.anchor.side === anchor.side &&
    current.anchor.end === anchor.end;

  setComposer(subjectKey, {
    anchor,
    text: seed.text ?? (same ? current.text : ""),
    findingId: seed.findingId ?? (same ? current.findingId : null),
    moving: seed.moving ?? null,
    busy: false,
    error: null,
  });
};

export const setPullComments = (subjectKey: string, pull: PullComments) =>
  commentsStore.setState((s) => ({ pulls: { ...s.pulls, [subjectKey]: pull } }));

export const setSessionComments = (subjectKey: string, session: SessionComments) =>
  commentsStore.setState((s) => ({ sessions: { ...s.sessions, [subjectKey]: session } }));

export const batchOf = (subjectKey: string): DraftBatch =>
  commentsStore.getState().batches[subjectKey] ?? emptyBatch;

export const setBatch = (subjectKey: string, batch: DraftBatch) => {
  commentsStore.setState((s) => {
    const batches = { ...s.batches };

    delete batches[subjectKey];

    // Re-inserted last, so the newest batches are the ones kept.
    if (batch.comments.length > 0 || batch.message !== "") batches[subjectKey] = batch;

    return { batches };
  });
  writeBatches(commentsStore.getState().batches);
};
