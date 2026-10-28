/**
 * Review on iPhone (Paper M5; DESIGN.md Review and Mobile App) for one agent session's Turn, over
 * the Host's shared connection: `ReviewView` fed by `useReview`, with Accept, Send back, "Ask
 * {harness} to fix" and verdicts sent to the Host.
 */
import { harnessEntry, type RiskFinding, type VerdictReason } from "@polaris/protocol";
import { Effect } from "effect";
import { useCallback, useMemo, useState } from "react";
import type { LiveHost } from "../runtime/hostConnection.ts";
import { useHost } from "../runtime/hosts.tsx";
import { acceptTurn, askToFix, flaggedCode, recordVerdict, sendBack } from "./actions.ts";
import type { LineRow } from "./diffRows.ts";
import { acceptState } from "./model.ts";
import { ReviewView } from "./ReviewView.tsx";
import { useReview } from "./useReview.ts";

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
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const { live, turn } = review;
  const session = review.session.kind === "ready" ? review.session.value.session : null;
  const summary = review.risk.kind === "ready" ? review.risk.value : null;

  const run = useCallback(
    <A, E extends { readonly message: string }>(
      effect: (client: LiveHost["client"]) => Effect.Effect<A, E>
    ) => {
      if (live === null) {
        setNotice("The host isn't connected");

        return Promise.resolve(false);
      }

      setNotice(null);

      return Effect.runPromise(
        effect(live.client).pipe(
          Effect.match({
            onSuccess: () => true,
            onFailure: (error) => {
              setNotice(error.message);

              return false;
            },
          })
        )
      ).catch(() => {
        setNotice("Something went wrong on this iPhone");

        return false;
      });
    },
    [live]
  );

  const accept = acceptState({
    risk: review.risk,
    turnEnded: turn !== null && turn.status !== "working",
    accepted:
      turn !== null && session !== null && (session.acceptedThroughIndex ?? -1) >= turn.index,
    sending,
  });

  const onAccept = useCallback(() => {
    if (turn === null || accept.kind !== "ready") return;
    setSending(true);
    void run((client) => acceptTurn(client, sessionId, turn.id)).finally(() => setSending(false));
  }, [accept.kind, run, sessionId, turn]);

  const onSendBack = useCallback(
    (reply: string) => void run((client) => sendBack(client, sessionId, reply)),
    [run, sessionId]
  );

  const onAskToFix = useCallback(
    (finding: RiskFinding, lines: ReadonlyArray<LineRow>) => {
      const code = flaggedCode(finding, lines);

      void run((client) => askToFix(client, sessionId, finding, code)).then((ok) => {
        if (ok) setSent((s) => new Set(s).add(finding.id));
      });
    },
    [run, sessionId]
  );

  const onVerdict = useCallback(
    (finding: RiskFinding, reason: VerdictReason | null) => {
      if (summary === null) return;
      void run((client) => recordVerdict(client, summary.id, finding, reason));
    },
    [run, summary]
  );

  const diffProblem = useMemo(() => {
    if (review.session.kind === "failed") return review.session.message;

    if (turn !== null && turn.status === "working") return "The diff shows when this turn ends.";

    return review.diff.kind === "failed" ? review.diff.message : null;
  }, [review.session, review.diff, turn]);

  return (
    <ReviewView
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
      onBack={onBack}
      onAccept={onAccept}
      onSendBack={onSendBack}
      onAskToFix={onAskToFix}
      onVerdict={onVerdict}
    />
  );
};
