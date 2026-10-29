/**
 * A turn's Review on iPhone (Paper MX-N) for one agent session's Turn, over the Host's shared
 * connection: `ReviewView` fed by `useReview`, with Accept, Send back, "Ask {harness} to fix",
 * verdicts and questions to the reviewer sent to the Host.
 */
import {
  type Command,
  harnessEntry,
  type RiskFinding,
  type VerdictReason,
} from "@polaris/protocol";
import { useCallback, useMemo, useState } from "react";
import { useHost } from "../runtime/hosts.tsx";
import {
  acceptCommand,
  askToFixCommand,
  flaggedCode,
  sendBackCommand,
  verdictCommand,
} from "./actions.ts";
import { canAccept } from "./accept/index.ts";
import type { LineRow } from "./diffRows.ts";
import { acceptState } from "./model.ts";
import { useAsks } from "./ReviewScreen/useAsks.ts";
import { ReviewView } from "./ReviewView.tsx";
import { reviewSlot } from "./submissions.ts";
import { useReview } from "./useReview.ts";
import { useReviewSubmissions } from "./useSubmissions.ts";

export interface ReviewScreenProps {
  readonly hostId: string;
  readonly sessionId: string;
  /** The Turn to review; null reviews the latest one that ended. */
  readonly turnId?: string | null;
  /** The colourblind (`-cvd`) diff palette. */
  readonly colourblind?: boolean;
  readonly onBack?: () => void;
}

export const ReviewScreen = ({
  hostId,
  sessionId,
  turnId = null,
  colourblind = false,
  onBack,
}: ReviewScreenProps) => {
  const connection = useHost(hostId);
  const review = useReview(connection, sessionId, turnId);
  const [notice, setNotice] = useState<string | null>(null);
  const { live, turn } = review;
  const submissions = useReviewSubmissions(hostId, live);
  const session = review.session.kind === "ready" ? review.session.value.session : null;
  const summary = review.risk.kind === "ready" ? review.risk.value : null;
  const asks = useAsks(live, summary);

  const submit = useCallback(
    (slot: string, payload: string, build: (itemId: string) => Command) => {
      setNotice(null);
      void submissions.submit(slot, payload, build).then((failure) => {
        if (failure !== null) setNotice(failure);
      });
    },
    [submissions.submit]
  );

  const acceptSlot = turn === null ? null : reviewSlot.accept(sessionId, turn.id);

  const accept = acceptState({
    risk: review.risk,
    turnEnded: turn !== null && turn.status !== "working",
    accepted:
      turn !== null && session !== null && (session.acceptedThroughIndex ?? -1) >= turn.index,
    sending: acceptSlot !== null && submissions.state(acceptSlot)?.kind === "sending",
  });

  const acceptable = canAccept(accept);

  const onAccept = useCallback(() => {
    if (turn === null || acceptSlot === null || !acceptable) return;
    submit(acceptSlot, "", () => acceptCommand(sessionId, turn.id));
  }, [acceptable, acceptSlot, submit, sessionId, turn]);

  const onSendBack = useCallback(
    (reply: string) => {
      if (turn === null) return;
      submit(reviewSlot.sendBack(sessionId, turn.id), reply.trim(), () =>
        sendBackCommand(sessionId, reply)
      );
    },
    [submit, sessionId, turn]
  );

  const onAskToFix = useCallback(
    (finding: RiskFinding, lines: ReadonlyArray<LineRow>) => {
      const code = flaggedCode(finding, lines);

      submit(reviewSlot.fix(sessionId, finding.id), code, (commentId) =>
        askToFixCommand(sessionId, finding, code, commentId)
      );
    },
    [submit, sessionId]
  );

  const onVerdict = useCallback(
    (finding: RiskFinding, reason: VerdictReason | null) => {
      if (summary === null) return;
      submit(
        reviewSlot.verdict(summary.id, finding.id),
        reason === null ? "up" : `down:${reason}`,
        (verdictId) => verdictCommand(summary.id, finding, reason, verdictId)
      );
    },
    [submit, summary]
  );

  const onAskReviewer = useCallback(
    (finding: RiskFinding, question: string) => asks.ask(finding.id, question),
    [asks.ask]
  );

  const sent = new Set(
    (summary?.findings ?? [])
      .filter((f) => submissions.state(reviewSlot.fix(sessionId, f.id))?.kind === "sent")
      .map((f) => f.id)
  );

  const diffProblem = useMemo(() => {
    if (review.session.kind === "failed") return review.session.message;

    if (turn !== null && turn.status === "working") return "The diff shows when this turn ends.";

    return review.diff.kind === "failed" ? review.diff.message : null;
  }, [review.session, review.diff, turn]);

  return (
    <ReviewView
      scope={`${hostId}/${sessionId}`}
      turnNumber={turn === null ? 0 : (turn.userTurnNumber ?? turn.index + 1)}
      sessionTitle={session === null || session.title === "" ? "Untitled" : session.title}
      harnessName={
        session === null ? "the agent" : (harnessEntry(session.harness)?.name ?? session.harness)
      }
      files={review.diff.kind === "ready" ? review.diff.value : null}
      diffProblem={diffProblem}
      summary={summary}
      accept={accept}
      colourblind={colourblind}
      notice={notice ?? (review.risk.kind === "failed" ? review.risk.message : null)}
      sent={sent}
      asks={asks.asks}
      askBlocked={asks.blocked}
      onBack={onBack}
      onAccept={onAccept}
      onSendBack={onSendBack}
      onAskToFix={onAskToFix}
      onVerdict={onVerdict}
      onAskReviewer={onAskReviewer}
    />
  );
};
