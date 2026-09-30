/** UI copy: glossary terms lowercase (DESIGN.md rule/glossary-lowercase), what happened (rule/say-what-happened). */
import type { ConnectionState, SessionState } from "@polaris/protocol";
import type { SessionEntry } from "../store/hostModel.ts";

export const connectionLabel: Readonly<Record<ConnectionState, string>> = {
  connected: "connected",
  reconnecting: "reconnecting",
  "needs-attention": "needs attention",
  offline: "offline",
};

export const sessionStateLabel: Readonly<Record<SessionState, string>> = {
  starting: "starting",
  working: "working",
  "needs-you": "needs you",
  idle: "idle",
  "in-terminal": "in terminal",
  dormant: "dormant",
  failed: "failed",
  archived: "archived",
};

const turnLabel = (entry: SessionEntry) => `turn ${entry.session.turnCount}`;

const STATE_LINES: Readonly<Record<SessionState, (entry: SessionEntry) => string>> = {
  starting: () => "Starting…",
  working: (e) => `Working · ${turnLabel(e)}`,
  "needs-you": () => "Needs you",
  idle: (e) => (e.session.turnCount === 0 ? "Idle" : `Idle · ${turnLabel(e)}`),
  "in-terminal": () => "In terminal",
  dormant: () => "Dormant · resumes on reply",
  failed: (e) => e.session.lastError ?? "Failed",
  archived: () => "Archived",
};

/** A session row's second line: what the session is doing right now. */
export const sessionLine = (entry: SessionEntry): string => {
  const request = entry.pendingApprovals[0];

  if (request !== undefined)
    return `Wants to ${request.title.charAt(0).toLowerCase()}${request.title.slice(1)}`;

  return STATE_LINES[entry.session.state](entry);
};

const MINUTE = 60_000;

/** "now", "42m", "5h", "3d": a row's trailing age. */
export const age = (iso: string, now: number): string => {
  const ms = now - Date.parse(iso);

  if (!Number.isFinite(ms) || ms < MINUTE) return "now";

  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}m`;

  if (ms < 24 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))}h`;

  return `${Math.floor(ms / (24 * 60 * MINUTE))}d`;
};

/** A path under the Host's home as `~/…`. */
export const homePath = (path: string, home: string | null): string =>
  home !== null && home !== "" && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
