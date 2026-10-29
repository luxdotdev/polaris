/**
 * When Accept asks first (Paper MX-T): once per set of open Criticals. Confirming acknowledges
 * them, so the next Accept goes straight through until a Critical the user hasn't seen opens.
 */
import type { RiskFinding } from "@polaris/protocol";
import type { AcceptState } from "../model.ts";

/** The identities (stable across re-runs) of the Criticals the user has accepted despite. */
export type Acknowledged = ReadonlySet<string>;

export const openCriticals = (findings: ReadonlyArray<RiskFinding>): ReadonlyArray<RiskFinding> =>
  findings.filter((f) => f.severity === "critical" && f.status === "open");

/** Accept acts when the Turn is ready, with or without open Criticals. */
export const canAccept = (state: AcceptState): boolean =>
  state.kind === "ready" || state.kind === "paused";

/** True while an open Critical hasn't been acknowledged, so Accept opens the confirmation. */
export const needsConfirmation = (
  criticals: ReadonlyArray<RiskFinding>,
  acknowledged: Acknowledged
): boolean => criticals.some((f) => !acknowledged.has(f.identity));

export const acknowledge = (
  acknowledged: Acknowledged,
  criticals: ReadonlyArray<RiskFinding>
): Acknowledged => new Set([...acknowledged, ...criticals.map((f) => f.identity)]);

/** "Accept turn 24 with a critical open?" */
export const confirmationTitle = (count: number, turnNumber: number | undefined): string => {
  const turn = turnNumber === undefined ? "this turn" : `turn ${turnNumber}`;
  const open = count === 1 ? "a critical open" : `${count} criticals open`;

  return `Accept ${turn} with ${open}?`;
};

export const confirmationBody = (count: number, agentName: string | undefined): string => {
  const ask = agentName === undefined ? "" : `, or ask ${agentName} about it first`;
  const again = count === 1 ? "this critical" : "these criticals";

  return `Accept anyway${ask}. You won't be asked again for ${again}.`;
};
