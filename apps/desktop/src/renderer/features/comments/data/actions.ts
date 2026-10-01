/**
 * What comments do. A pull request's go to GitHub through the main process's client
 * (`github.review.*`): the pending review is created on the first comment and stays the
 * truth, so the detail is fetched again after every change. An Agent Session's collect in
 * the draft batch until "Send to session" sends them as one Turn (`SendFeedback`).
 */
import type { SessionId } from "@polaris/protocol";
import type { IpcError } from "../../../../shared/api.ts";
import type { ReviewEvent } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { polaris } from "../../bridge.ts";
import { refreshPullDetail, updateSurface } from "../../review/index.ts";
import { dispatch, refusalText } from "../../session/dispatch.ts";
import { addDraft, emptyBatch, removeDraft, toFeedback } from "../model/feedback.ts";
import {
  batchOf,
  commentsStore,
  type ComposerState,
  composerOf,
  patchComposer,
  type PullComments,
  setBatch,
  setComposer,
} from "./store.ts";

export type Done = { readonly ok: true } | { readonly ok: false; readonly message: string };

const failed = (error: IpcError): Done => ({ ok: false, message: refusalText(error) });

const ok: Done = { ok: true };

const notLoaded: Done = { ok: false, message: "The pull request hasn’t loaded" };

const pullOf = (subjectKey: string): PullComments | undefined =>
  commentsStore.getState().pulls[subjectKey];

const refresh = (pull: PullComments) => refreshPullDetail(pull.pull);

/** Closes the composer and the selection it was opened for. */
export const closeComposer = (subjectKey: string) => {
  setComposer(subjectKey, null);
  updateSurface(subjectKey, { selection: null });
};

const addThread = (pull: PullComments, composer: ComposerState) => {
  const { anchor } = composer;
  const side = anchor.side === "old" ? "left" : "right";
  const ranged = anchor.start !== anchor.end;

  return polaris().request("github.review.addThread", {
    pull: pull.pull,
    pullId: pull.pullId,
    commitOid: pull.commitOid,
    path: anchor.path,
    body: composer.text.trim(),
    subjectType: "line",
    line: anchor.end,
    side,
    startLine: ranged ? anchor.start : null,
    startSide: ranged ? side : null,
  });
};

/** Runs `work` with the composer marked busy; a failure stays in the composer, as GitHub said it. */
const withComposer = async (
  subjectKey: string,
  work: (composer: ComposerState) => Promise<Done>
): Promise<Done> => {
  const composer = composerOf(subjectKey);

  if (composer === undefined || composer.busy || composer.text.trim() === "") {
    return { ok: false, message: "Write a comment first" };
  }

  patchComposer(subjectKey, { busy: true, error: null });
  const done = await work(composer);

  if (done.ok) closeComposer(subjectKey);
  else patchComposer(subjectKey, { busy: false, error: done.message });

  return done;
};

/** "Add to review ⌘↵": a draft in GitHub's pending review (created on the first one). */
export const addToReview = (subjectKey: string) =>
  withComposer(subjectKey, async (composer) => {
    const pull = pullOf(subjectKey);

    if (pull === undefined) return notLoaded;
    const added = await addThread(pull, composer);

    if (!added.ok) return failed(added.error);

    if (composer.moving !== null) {
      await polaris().request("github.review.editComment", {
        pull: pull.pull,
        commentId: composer.moving,
        body: null,
      });
    }

    await refresh(pull);

    return ok;
  });

/** "Comment now": a single comment, published at once (only offered with nothing pending). */
export const commentNow = (subjectKey: string) =>
  withComposer(subjectKey, async (composer) => {
    const pull = pullOf(subjectKey);

    if (pull === undefined) return notLoaded;
    const added = await addThread(pull, composer);

    if (!added.ok) return failed(added.error);

    const submitted = await polaris().request("github.review.submit", {
      pull: pull.pull,
      pullId: pull.pullId,
      event: "comment",
      body: "",
    });

    await refresh(pull);

    return submitted.ok ? ok : failed(submitted.error);
  });

type Result = { readonly ok: true } | { readonly ok: false; readonly error: IpcError };

/** A request about the open pull request, then a fresh detail. */
const onPull = async (
  subjectKey: string,
  run: (pull: PullComments) => Promise<Result>
): Promise<Done> => {
  const pull = pullOf(subjectKey);

  if (pull === undefined) return notLoaded;
  const result = await run(pull);

  await refresh(pull);

  return result.ok ? ok : failed(result.error);
};

/** A reply joins the pending review when there is one, as on GitHub. */
export const reply = (subjectKey: string, threadId: string, body: string) =>
  onPull(subjectKey, (pull) =>
    polaris().request("github.review.reply", {
      pull: pull.pull,
      pullId: pull.pullId,
      threadId,
      body: body.trim(),
    })
  );

export const resolveThread = (subjectKey: string, threadId: string, resolved: boolean) =>
  onPull(subjectKey, (pull) =>
    polaris().request("github.review.resolve", { pull: pull.pull, threadId, resolved })
  );

/** Deletes a comment (a draft discarded, or one of the viewer's own). */
export const deleteComment = (subjectKey: string, commentId: string) =>
  onPull(subjectKey, (pull) =>
    polaris().request("github.review.editComment", { pull: pull.pull, commentId, body: null })
  );

export const submitReview = (subjectKey: string, event: ReviewEvent, body: string) =>
  onPull(subjectKey, (pull) =>
    polaris().request("github.review.submit", {
      pull: pull.pull,
      pullId: pull.pullId,
      event,
      body: body.trim(),
    })
  );

/** Throws the whole pending review away on GitHub. */
export const discardReview = (subjectKey: string) =>
  onPull(subjectKey, (pull) =>
    polaris().request("github.review.discard", { pull: pull.pull, pullId: pull.pullId })
  );

// ── Agent Session feedback ──────────────────────────────────────────────────

const draftFrom = (composer: ComposerState) => ({
  id: crypto.randomUUID(),
  path: composer.anchor.path,
  lines: { start: composer.anchor.start, end: composer.anchor.end, side: composer.anchor.side },
  code: composer.anchor.code,
  note: composer.text.trim(),
  findingId: composer.findingId,
});

/** "Add to feedback ⌘↵": into this device's draft batch. */
export const addToFeedback = (subjectKey: string) =>
  withComposer(subjectKey, (composer) => {
    setBatch(subjectKey, addDraft(batchOf(subjectKey), draftFrom(composer)));

    return Promise.resolve(ok);
  });

export const removeFeedback = (subjectKey: string, id: string) =>
  setBatch(subjectKey, removeDraft(batchOf(subjectKey), id));

export const setFeedbackMessage = (subjectKey: string, message: string) =>
  setBatch(subjectKey, { ...batchOf(subjectKey), message });

/** Sends the batch as one Turn; it clears only once the Host has it. */
export const sendFeedback = async (subjectKey: string): Promise<Done> => {
  const session = commentsStore.getState().sessions[subjectKey];
  const feedback = toFeedback(batchOf(subjectKey));

  if (session === undefined || feedback === null) return { ok: false, message: "Nothing to send" };

  const sent = await dispatch(
    session.hostKey,
    Commands.SendFeedback({
      // SAFETY: the session id is the open subject's, from the Host.
      sessionId: session.sessionId as SessionId,
      feedback,
      attachments: [],
    })
  );

  if (!sent.ok) return failed(sent.error);
  setBatch(subjectKey, emptyBatch);

  return ok;
};

/** "Send now": this comment and the rest of the batch, at once. */
export const sendNow = (subjectKey: string) =>
  withComposer(subjectKey, async (composer) => {
    const before = batchOf(subjectKey);

    setBatch(subjectKey, addDraft(before, draftFrom(composer)));
    const done = await sendFeedback(subjectKey);

    if (!done.ok) setBatch(subjectKey, before);

    return done;
  });
