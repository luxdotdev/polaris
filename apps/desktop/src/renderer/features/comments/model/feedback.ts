/**
 * An Agent Session's feedback (ENG-223): comments collect as a draft batch on this device;
 * "Send to session" sends one Turn (the optional message, then each comment quoted), the
 * batch clears, and the comments stay on the diff as "sent with turn N".
 */
import type { FeedbackBatch, FeedbackComment } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { groupTurns } from "../../session/model/turnGroups.ts";

export type Draft = Plain<FeedbackComment>;

export interface DraftBatch {
  readonly message: string;
  readonly comments: ReadonlyArray<Draft>;
}

export const emptyBatch: DraftBatch = { message: "", comments: [] };

export const addDraft = (batch: DraftBatch, draft: Draft): DraftBatch => ({
  ...batch,
  comments: [...batch.comments.filter((c) => c.id !== draft.id), draft],
});

export const removeDraft = (batch: DraftBatch, id: string): DraftBatch => ({
  ...batch,
  comments: batch.comments.filter((c) => c.id !== id),
});

/** The batch as `SendFeedback` carries it; null when there is nothing to send. */
export const toFeedback = (batch: DraftBatch): Plain<FeedbackBatch> | null => {
  const message = batch.message.trim();

  if (message === "" && batch.comments.length === 0) return null;

  return { message: message === "" ? null : message, comments: batch.comments };
};

/** A comment already sent, and the Turn it went with. */
export interface SentComment {
  readonly comment: Draft;
  /** "turn 25": the Turn's number as the UI shows it (`turnGroups.ts`). */
  readonly turnNumber: number;
}

export const sentComments = (views: ReadonlyArray<TurnView>): ReadonlyArray<SentComment> =>
  groupTurns(views).flatMap((group) =>
    group.views.flatMap(({ turn }) =>
      (turn.feedback?.comments ?? []).map((comment) => ({ comment, turnNumber: group.number }))
    )
  );

/** The number the next Turn will have ("Feedback for turn 25"): one past the latest shown. */
export const nextTurnNumber = (views: ReadonlyArray<TurnView>) =>
  (groupTurns(views).at(-1)?.number ?? 0) + 1;

const lineLabel = (lines: Draft["lines"]) =>
  lines.start === lines.end ? `${lines.start}` : `${lines.start}–${lines.end}`;

/** "index.html:412". */
export const draftPlace = (draft: Draft) =>
  `${draft.path.slice(draft.path.lastIndexOf("/") + 1)}:${lineLabel(draft.lines)}`;

/** "2 comments · 1 drafting". */
export const batchCaption = (batch: DraftBatch, drafting: boolean) => {
  const n = batch.comments.length;
  const parts = [`${n} ${n === 1 ? "comment" : "comments"}`];

  if (drafting) parts.push("1 drafting");

  return parts.join(" · ");
};
