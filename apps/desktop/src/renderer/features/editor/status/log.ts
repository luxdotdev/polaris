/**
 * The language server log as this Client saw it (DESIGN.md, Editor: Language server log).
 * Lines arrive from the context watch's Log events, a stopped server's stderr tail, and later
 * the Daemon's live log feed; every source appends the same `LogLine`, so the tab never changes.
 */
import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type LogLevel = "error" | "warning" | "info" | "debug";

export interface LogLine {
  readonly at: number;
  readonly level: LogLevel;
  readonly text: string;
  /** Where the line came from: a context event, a stopped server's stderr, or the live feed. */
  readonly origin: "event" | "stderr" | "feed";
}

/** A feed line's place: one server generation's sequence, so a re-subscribe adds nothing twice. */
export interface FeedCursor {
  readonly contextId: string;
  readonly generation: number;
}

/** One log per Host, checkout and provider: what one language server on one Host wrote. */
export interface LogScope {
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly providerId: string;
}

export interface ServerLog {
  readonly scope: LogScope;
  readonly lines: readonly LogLine[];
  /** Lines dropped from the front once the log passed its bound. */
  readonly dropped: number;
  /** The stderr tail last folded in, so a repeated Stopped snapshot adds nothing. */
  readonly stderr: string;
  /** The last feed sequence seen per server generation. */
  readonly cursors: Readonly<Record<string, number>>;
}

export const LOG_LIMIT = 5000;

export const logKey = (scope: LogScope) =>
  JSON.stringify([scope.hostKey, scope.checkout, scope.providerId]);

export const logStore = createStore<{ readonly logs: Readonly<Record<string, ServerLog>> }>(() => ({
  logs: {},
}));

const empty = (scope: LogScope): ServerLog => ({
  scope,
  lines: [],
  dropped: 0,
  stderr: "",
  cursors: {},
});

export const appendLogLines = (scope: LogScope, lines: readonly LogLine[]) => {
  if (lines.length === 0) return;
  const key = logKey(scope);

  logStore.setState((state) => {
    const log = state.logs[key] ?? empty(scope);
    const all = [...log.lines, ...lines];
    const over = Math.max(0, all.length - LOG_LIMIT);

    return {
      logs: {
        ...state.logs,
        [key]: { ...log, lines: over === 0 ? all : all.slice(over), dropped: log.dropped + over },
      },
    };
  });
};

/** Folds a stopped server's last stderr, once per distinct tail, unless the feed already had it. */
export const appendStderr = (scope: LogScope, stderr: string, at = Date.now()) => {
  const key = logKey(scope);
  const known = logStore.getState().logs[key];

  if (stderr.trim() === "" || known?.stderr === stderr) return;

  if (known?.lines.some((line) => line.origin === "feed" && stderr.includes(line.text))) return;
  appendLogLines(
    scope,
    stderr
      .replace(/\s+$/, "")
      .split(/\r?\n/)
      .map((text) => ({ at, level: "error" as const, text, origin: "stderr" as const }))
  );
  logStore.setState((state) => {
    const log = state.logs[key] ?? empty(scope);

    return { logs: { ...state.logs, [key]: { ...log, stderr } } };
  });
};

export const useServerLog = (key: string) => useStore(logStore, (state) => state.logs[key] ?? null);

const cursorKey = (cursor: FeedCursor) => `${cursor.contextId}#${cursor.generation}`;

/** Lines from the Daemon's live feed (Snapshot backlog or Line), each sequence once. */
export const appendFeed = (
  scope: LogScope,
  cursor: FeedCursor,
  lines: readonly P.LanguageServerLogLine[]
) => {
  const key = logKey(scope);
  const seen = logStore.getState().logs[key]?.cursors[cursorKey(cursor)] ?? 0;
  const fresh = lines.filter((line) => line.sequence > seen);

  if (fresh.length === 0) return;
  appendLogLines(
    scope,
    fresh.map((line) => ({ at: line.time, level: line.level, text: line.text, origin: "feed" }))
  );

  const last = Math.max(...fresh.map((line) => line.sequence));

  logStore.setState((state) => {
    const log = state.logs[key] ?? empty(scope);

    return {
      logs: {
        ...state.logs,
        [key]: { ...log, cursors: { ...log.cursors, [cursorKey(cursor)]: last } },
      },
    };
  });
};
