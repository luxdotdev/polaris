/**
 * Settings → Extensions, pure (ENG-401): the Grant picker's words, a Pairing
 * row's lines, and the order Pairings list in.
 */
import { GRANT_KINDS, type GrantKind, type Pairing } from "@polaris/protocol";
import type { Plain } from "../../../shared/api.ts";
import { timeAgo } from "../settings/model/github.ts";

export interface GrantChoice {
  readonly kind: GrantKind;
  readonly label: string;
  readonly help: string;
}

const COPY: Readonly<Record<GrantKind, { readonly label: string; readonly help: string }>> = {
  read: { label: "Read", help: "See agent sessions, turns, approvals and diffs" },
  approve: {
    label: "Approve",
    help: "Allow or deny approvals. Also needed to send turns to a session that approves on its own",
  },
  turn: { label: "Send turns", help: "Send turns to agent sessions that are already running" },
  start: {
    label: "Start agent sessions",
    help: "Start new agent sessions in this host's workspaces",
  },
  voice: { label: "Voice", help: "Talk to agent sessions by voice" },
};

export const GRANT_CHOICES: ReadonlyArray<GrantChoice> = GRANT_KINDS.map((kind) => ({
  kind,
  ...COPY[kind],
}));

/** What a new Pairing starts with. */
export const DEFAULT_GRANT: ReadonlyArray<GrantKind> = ["read"];

/** "Read · approve · send turns", in the catalogue's order; "Nothing" for an empty Grant. */
export const grantLine = (grant: ReadonlyArray<GrantKind>): string => {
  const words = GRANT_CHOICES.flatMap((c) =>
    grant.includes(c.kind) ? [c.label.toLowerCase()] : []
  );

  if (words.length === 0) return "Nothing";

  const [first = "", ...rest] = words;

  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" · ");
};

export const toggleGrant = (
  grant: ReadonlyArray<GrantKind>,
  kind: GrantKind
): ReadonlyArray<GrantKind> =>
  grant.includes(kind)
    ? grant.filter((k) => k !== kind)
    : GRANT_KINDS.filter((k) => k === kind || grant.includes(k));

/** "used 4 minutes ago", "not used yet". */
export const usedLine = (pairing: Plain<Pairing>, now: number): string =>
  pairing.lastUsedAt === null
    ? "not used yet"
    : `used ${timeAgo(now - Date.parse(pairing.lastUsedAt))}`;

/** Live Pairings, newest first; revoked ones are gone from Settings. */
export const livePairings = (
  pairings: ReadonlyArray<Plain<Pairing>>
): ReadonlyArray<Plain<Pairing>> =>
  pairings
    .filter((p) => p.revokedAt === null)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

/** The name a Pairing can be made with, or null while it is blank. */
export const pairName = (draft: string): string | null => {
  const name = draft.trim();

  return name === "" ? null : name;
};
