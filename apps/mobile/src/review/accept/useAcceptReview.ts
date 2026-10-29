import type { RiskFinding } from "@polaris/protocol";
import { useCallback, useMemo, useState } from "react";
import { haptics } from "../../motion/index.ts";
import type { AcceptState } from "../model.ts";
import {
  type Acknowledged,
  acknowledge,
  canAccept,
  needsConfirmation,
  openCriticals,
} from "./confirmation.ts";

export interface AcceptReviewInput {
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
export const useAcceptReview = ({ state, findings, onAccept }: AcceptReviewInput): AcceptReview => {
  const [asking, setAsking] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Acknowledged>(() => new Set());
  const criticals = useMemo(() => openCriticals(findings), [findings]);
  const ready = canAccept(state);

  const accept = useCallback(() => {
    if (!ready) return;

    if (needsConfirmation(criticals, acknowledged)) {
      setAsking(true);
      haptics.warning();
    } else onAccept();
  }, [ready, criticals, acknowledged, onAccept]);

  const confirm = useCallback(() => {
    setAsking(false);
    setAcknowledged((current) => acknowledge(current, criticals));

    if (ready) onAccept();
  }, [criticals, ready, onAccept]);

  const dismiss = useCallback(() => setAsking(false), []);

  // The sheet follows the live findings: it closes once nothing open is left to confirm.
  const confirming = asking && ready && criticals.length > 0 ? criticals : null;

  return { accept, confirming, confirm, dismiss };
};
