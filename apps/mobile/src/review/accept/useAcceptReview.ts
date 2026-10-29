import type { RiskFinding } from "@polaris/protocol";
import { useCallback, useState } from "react";
import type { AcceptState } from "../model.ts";

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

const openCriticals = (findings: ReadonlyArray<RiskFinding>) =>
  findings.filter((f) => f.severity === "critical" && f.status === "open");

/** Stub of Accept with MX-T's confirmation; P3 builds the real one. */
export const useAcceptReview = ({ findings, onAccept }: AcceptReviewInput): AcceptReview => {
  const [confirming, setConfirming] = useState<ReadonlyArray<RiskFinding> | null>(null);

  const accept = useCallback(() => {
    const criticals = openCriticals(findings);

    if (criticals.length > 0) setConfirming(criticals);
    else onAccept();
  }, [findings, onAccept]);

  const confirm = useCallback(() => {
    setConfirming(null);
    onAccept();
  }, [onAccept]);

  const dismiss = useCallback(() => setConfirming(null), []);

  return { accept, confirming, confirm, dismiss };
};
