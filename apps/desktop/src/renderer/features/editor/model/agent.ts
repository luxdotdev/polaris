/**
 * An agent session editing an open file (DESIGN.md, Editor: "An agent editing
 * your file"; Paper E3). The explorer feeds what the session feed knows; the
 * lines it wrote come from the disk changes the editor reloads.
 */
import type { HarnessKind, SessionId } from "@polaris/protocol";

export interface AgentEdit {
  readonly sessionId: SessionId;
  /** The session's title ("Polaris planning"). */
  readonly title: string;
  readonly harness: HarnessKind;
  readonly turnId: string;
  /** 1-based, as "turn 24". */
  readonly turnIndex: number;
  /** ISO; "elapsed" counts from it. */
  readonly turnStartedAt: string;
  /** ISO, the newest change to this file; null before the first. */
  readonly lastChangeAt: string | null;
  /** A change to this file is in progress now. */
  readonly live: boolean;
}

/** "12s", "1m 12s", "1h 4m": the Working strip's elapsed time. */
export const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));

  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);

  if (m < 60) return `${m}m ${s % 60}s`;

  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** "Polaris planning · turn 24 · 1m 12s". */
export const stripCaption = (edit: AgentEdit, now: number): string =>
  `${edit.title} · turn ${edit.turnIndex} · ${elapsed(now - Date.parse(edit.turnStartedAt))}`;

/** "Claude Code is editing this file". */
export const stripTitle = (harnessName: string) => `${harnessName} is editing this file`;

/** The status bar while following: "Following Claude Code · Ln 15". */
export const followingText = (harnessName: string, line: number) =>
  `Following ${harnessName} · Ln ${line}`;
