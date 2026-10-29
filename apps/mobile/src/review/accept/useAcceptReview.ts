import type { RiskFinding } from "@polaris/protocol";
import { useCallback, useMemo, useState } from "react";
import { haptics } from "../../motion/index.ts";
import type { AcceptState } from "../model.ts";
import {
  acknowledgedIn,
  canAccept,
  needsConfirmation,
  openCriticals,
  rememberAcknowledged,
} from "./confirmation.ts";

export interface AcceptReviewInput {
  /** The agent session, `hostId/sessionId`: what was accepted despite is remembered per session. */
  readonly scope: string;
  readonly state: AcceptState;
  /** The reviewed Turn's findings; the open Criticals among them decide the confirmation. */
  readonly findings: ReadonlyArray<RiskFinding>;
  /** Sends the accept command. */
  readonly onAccept: () => void;
}

export interface AcceptReview {
  /** Accepts, or opens the Critical confirmation (MX-T) when Criticals are open. */
  readonly accept: () => void;
  /** The open Critical findings the confirmation names, or null while it's closed. */
  readonly confirming: ReadonlyArray<RiskFinding> | null;
  /** Accepts despite the open Criticals and closes the confirmation. */
  readonly confirm: () => void;
  readonly dismiss: () => void;
}

/**
 * Accept through MX-T: it asks once per set of open Criticals, with a warning haptic, and asks
 * again only when a Critical opens that the user hasn't accepted despite.
 */
export const useAcceptReview = ({
  scope,
  state,
  findings,
  onAccept,
}: AcceptReviewInput): AcceptReview => {
  const [asking, setAsking] = useState(false);
  const criticals = useMemo(() => openCriticals(findings), [findings]);
  const ready = canAccept(state);

  const accept = useCallback(() => {
    if (!ready) return;

    if (needsConfirmation(criticals, acknowledgedIn(scope))) {
      setAsking(true);
      haptics.warning();
    } else onAccept();
  }, [ready, criticals, scope, onAccept]);

  const confirm = useCallback(() => {
    setAsking(false);
    rememberAcknowledged(scope, criticals);

    if (ready) onAccept();
  }, [criticals, scope, ready, onAccept]);

  const dismiss = useCallback(() => setAsking(false), []);

  // The sheet follows the live findings: it closes once nothing open is left to confirm.
  const confirming = asking && ready && criticals.length > 0 ? criticals : null;

  return { accept, confirming, confirm, dismiss };
};
