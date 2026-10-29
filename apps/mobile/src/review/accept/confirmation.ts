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

const acknowledgedBySession = new Map<string, Acknowledged>();

const NONE: Acknowledged = new Set();

/** What the user accepted despite in one agent session (`hostId/sessionId`), for the app's life. */
export const acknowledgedIn = (scope: string): Acknowledged =>
  acknowledgedBySession.get(scope) ?? NONE;

export const rememberAcknowledged = (scope: string, criticals: ReadonlyArray<RiskFinding>) => {
  acknowledgedBySession.set(scope, acknowledge(acknowledgedIn(scope), criticals));
};

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

const them = (count: number) => (count === 1 ? "it" : "them");

export const confirmationBody = (count: number, agentName: string | undefined): string => {
  const ask = agentName === undefined ? "" : `, or ask ${agentName} about ${them(count)} first`;
  const again = count === 1 ? "this critical" : "these criticals";

  return `Accept anyway${ask}. You won't be asked again for ${again}.`;
};

/** "Ask Claude Code about them" */
export const askLabel = (count: number, agentName: string): string =>
  `Ask ${agentName} about ${them(count)}`;

/** MX-T names this many Criticals and counts the rest, so its actions stay on screen. */
export const LISTED_CRITICALS = 3;

/** "and 4 more criticals", under the listed ones; null when every one is listed. */
export const moreCriticals = (count: number): string | null => {
  const more = count - LISTED_CRITICALS;

  if (more <= 0) return null;

  return more === 1 ? "and 1 more critical" : `and ${more} more criticals`;
};
