/**
 * Keeps an open Review's comments in step: mirrors the pull request's detail or the
 * session's sent feedback into the comments store, opens the composer under the lines the
 * user selects, and puts every comment row (threads, drafts, sent feedback, the composer)
 * into the diff. Renders nothing.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { PullSubject, SessionSubject } from "../../../routes/review.ts";
import {
  emptySurface,
  type ReviewAnnotation,
  type ReviewSlotProps,
  subjectKey as keyOf,
  surfaceStore,
  updateSurface,
  usePullDetail,
} from "../../review/index.ts";
import { useSession } from "../../session/hooks.ts";
import { type Draft, nextTurnNumber, sentComments, type SentComment } from "../model/feedback.ts";
import { placeThreads } from "../model/threads.ts";
import {
  type ComposerAnchor,
  openComposer,
  setPullComments,
  setSessionComments,
  useComments,
} from "../data/store.ts";
import { Composer } from "./Composer.tsx";
import { DraftRow, SentRow } from "./FeedbackRows.tsx";
import { ThreadCard } from "./ThreadCard.tsx";

const PullSync = ({
  subjectKey,
  subject,
  head,
}: {
  readonly subjectKey: string;
  readonly subject: PullSubject;
  readonly head: string | null;
}) => {
  const { repo, number, pullId } = subject.pull;
  const detail = usePullDetail(subject.pull);
  const loaded = detail.kind === "ok" ? detail.detail : null;

  useEffect(() => {
    setPullComments(subjectKey, {
      pull: { repo, number },
      pullId: loaded?.id ?? pullId ?? "",
      commitOid: head ?? loaded?.headRefOid ?? null,
      detail: loaded,
      settled: detail.kind !== "loading",
    });
  }, [subjectKey, repo, number, pullId, loaded, head, detail.kind]);

  return null;
};

const SessionSync = ({
  subjectKey,
  subject,
}: {
  readonly subjectKey: string;
  readonly subject: SessionSubject;
}) => {
  const { hostKey, sessionId } = subject;
  const model = useSession(hostKey, sessionId);

  useEffect(() => {
    const turns = model.turns.map((t) => t.turn);

    setSessionComments(subjectKey, {
      hostKey,
      sessionId,
      nextTurn: nextTurnNumber(turns),
      sent: sentComments(turns),
    });
  }, [subjectKey, hostKey, sessionId, model.turns]);

  return null;
};

/** A new selection opens the composer under its last line. */
const useSelectionComposer = (key: string) => {
  const selection = useStore(surfaceStore, (s) => (s[key] ?? emptySurface).selection);

  useEffect(() => {
    if (selection !== null) openComposer(key, selection);
  }, [key, selection]);
};

const NO_SENT: ReadonlyArray<SentComment> = [];

const NO_DRAFTS: ReadonlyArray<Draft> = [];

const useAnnotations = (key: string): ReadonlyArray<ReviewAnnotation> => {
  const detail = useComments((s) => s.pulls[key]?.detail ?? null);
  const sent = useComments((s) => s.sessions[key]?.sent ?? NO_SENT);
  const drafts = useComments((s) => s.batches[key]?.comments ?? NO_DRAFTS);
  // The anchor, not the composer: typing changes the text, not the rows.
  const anchor: ComposerAnchor | undefined = useComments((s) => s.composers[key]?.anchor);

  return useMemo(() => {
    const threads =
      detail === null
        ? []
        : placeThreads(detail.threads).inline.map((t) => ({
            id: `thread:${t.thread.id}`,
            path: t.path,
            side: t.side,
            line: t.line,
            render: () => <ThreadCard subjectKey={key} threadId={t.thread.id} />,
          }));

    const draftRows = drafts.map((d) => ({
      id: `draft:${d.id}`,
      path: d.path,
      side: d.lines.side,
      line: d.lines.end,
      render: () => <DraftRow subjectKey={key} draftId={d.id} />,
    }));

    const sentRows = sent.map((s) => ({
      id: `sent:${s.comment.id}`,
      path: s.comment.path,
      side: s.comment.lines.side,
      line: s.comment.lines.end,
      render: () => <SentRow sent={s} />,
    }));

    const composer =
      anchor === undefined
        ? []
        : [
            {
              id: `composer:${anchor.path}:${anchor.side}:${anchor.start}:${anchor.end}`,
              path: anchor.path,
              side: anchor.side,
              line: anchor.end,
              render: () => <Composer subjectKey={key} />,
            },
          ];

    return [...threads, ...sentRows, ...draftRows, ...composer];
  }, [key, detail, sent, drafts, anchor]);
};

export const CommentsSync = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const annotations = useAnnotations(key);

  useSelectionComposer(key);

  useEffect(() => {
    updateSurface(key, { annotations });
  }, [key, annotations]);

  return props.subject.kind === "pull" ? (
    <PullSync
      subjectKey={key}
      subject={props.subject}
      head={props.checkout?.checkout.head ?? null}
    />
  ) : (
    <SessionSync subjectKey={key} subject={props.subject} />
  );
};
