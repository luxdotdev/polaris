/**
 * Output's default diff scope: the whole Agent Session, from its first Turn's checkpoint
 * to its latest's (`git.diff` with the Turns spec). The Turn menu narrows it to one Turn.
 */
import type { SessionId, Turn, TurnId } from "@polaris/protocol";
import { useEffect, useMemo, useState } from "react";
import type { TurnView } from "../../../store/sessionModel.ts";
import { polaris } from "../../bridge.ts";
import { hasCapability, useHost } from "../hooks.ts";
import {
  groupOf,
  groupSpan,
  groupTurns,
  type TurnGroup,
  type TurnSpan,
} from "../model/turnGroups.ts";
import { OLDER_PAGE } from "../older.ts";
import { spanDiffable } from "../turnDiff.ts";

/** Where the session scope starts. */
export interface ScopeStart {
  readonly id: TurnId;
  /** The Turn number it starts at when earlier Turns have no checkpoint; null from the first. */
  readonly skipped: number | null;
}

/** Why the session scope isn't every Turn, for the line above its diff. */
export type ScopeNote =
  | { readonly kind: "partial"; readonly retry: () => void }
  | { readonly kind: "skipped"; readonly number: number };

/** The whole session's span, and why it isn't every Turn. */
export interface SessionScope {
  readonly span: TurnSpan | null;
  readonly note: ScopeNote | null;
}

/** Each session's start, once fetched (null: no fetched Turn has a checkpoint). */
const starts = new Map<string, ScopeStart | null>();

/** The earliest Turn with a before-checkpoint, its number when it isn't the session's first. */
export const earliestCheckpointed = (turns: ReadonlyArray<Turn>): ScopeStart | null => {
  const turn = turns.find((t) => t.checkpointBefore !== null);

  if (turn === undefined) return null;

  return {
    id: turn.id,
    skipped: turn.index === 0 ? null : (turn.userTurnNumber ?? turn.index + 1),
  };
};

/** The session's first page of Turns, asked of the Host when only later pages are loaded. */
const fetchStart = async (
  hostKey: string,
  sessionId: SessionId,
  loadedIndex: number
): Promise<{ readonly start: ScopeStart | null } | null> => {
  const result = await polaris().request("session.turns", {
    hostKey,
    sessionId,
    beforeIndex: Math.min(loadedIndex, OLDER_PAGE),
    limit: OLDER_PAGE,
  });

  return result.ok ? { start: earliestCheckpointed(result.value.turns.map((t) => t.turn)) } : null;
};

/** The session's start when its first Turn is loaded or fetched; undefined while unknown. */
const knownStart = (key: string, turns: ReadonlyArray<Turn>): ScopeStart | null | undefined => {
  const first = turns[0];

  if (first?.index === 0) return earliestCheckpointed(turns);

  return starts.get(key);
};

/**
 * The span of every Turn in the session, from the earliest with a checkpoint; null before
 * it has one or while its start is fetched. A failed fetch shows the loaded Turns, and says so.
 */
export const useSessionSpan = (
  hostKey: string,
  sessionId: SessionId,
  views: ReadonlyArray<TurnView>
): SessionScope => {
  const key = `${hostKey}\u0000${sessionId}`;
  const turns = useMemo(() => views.map((v) => v.turn), [views]);
  const loaded = turns[0] ?? null;
  const last = turns.at(-1)?.id ?? null;
  const known = knownStart(key, turns);

  // The last fetch's outcome: a new object each time, so a success renders the start it cached.
  const [fetched, setFetched] = useState<{ readonly key: string; readonly ok: boolean } | null>(
    null
  );

  const [attempt, setAttempt] = useState(0);
  const fetching = loaded !== null && known === undefined;
  const loadedIndex = loaded?.index ?? 0;

  // Each new Turn tries a failed fetch again, as Retry does.
  useEffect(() => {
    if (!fetching) return undefined;
    let live = true;

    void fetchStart(hostKey, sessionId, loadedIndex).then((page) => {
      if (page !== null) starts.set(key, page.start);

      if (live) setFetched({ key, ok: page !== null });
    });

    return () => {
      live = false;
    };
  }, [fetching, hostKey, sessionId, key, loadedIndex, last, attempt]);

  if (loaded === null || last === null) return { span: null, note: null };

  const failed = fetched?.key === key && !fetched.ok;

  if (known === undefined && !failed) return { span: null, note: null };
  // Without the Host's first page, or with no checkpoint on it, the loaded Turns stand in.
  const start = known ?? earliestCheckpointed(turns) ?? { id: loaded.id, skipped: null };

  const note: ScopeNote | null =
    known === undefined
      ? { kind: "partial", retry: () => setAttempt((n) => n + 1) }
      : start.skipped === null
        ? null
        : { kind: "skipped", number: start.skipped };

  return { span: { first: start.id, last }, note };
};

/** Every loaded Turn as one group, for the session scope's Comments; null before a Turn. */
const wholeSession = (
  groups: ReadonlyArray<TurnGroup>,
  views: ReadonlyArray<TurnView>
): TurnGroup | null => {
  const first = groups[0];

  return first === undefined ? null : { id: first.id, number: first.number, views };
};

/** What the Changes tab diffs: the Turn picked (`diffTurnId`), else the whole session. */
export const useDiffScope = (
  hostKey: string,
  sessionId: SessionId,
  turns: ReadonlyArray<TurnView>,
  diffTurnId: string | null
) => {
  const groups = groupTurns(turns);
  const host = useHost(hostKey);
  const { span: sessionSpan, note } = useSessionSpan(hostKey, sessionId, turns);
  const everyTurn = useMemo(() => wholeSession(groups, turns), [groups, turns]);

  // A Daemon without `git.diff-turns` diffs one Turn at a time: it keeps the latest as the default.
  const whole =
    hasCapability(host, "git.diff-turns") ||
    (sessionSpan !== null && spanDiffable(sessionSpan, host));

  const narrowed = groupOf(groups, diffTurnId) ?? (whole ? null : (groups.at(-1) ?? null));

  return {
    groups,
    /** The Turn shown; null shows the whole session. */
    narrowed,
    whole,
    /** The Turns the diff covers, as a group (Comments, the diff's revision). */
    shown: narrowed ?? everyTurn,
    span: narrowed === null ? sessionSpan : groupSpan(narrowed),
    /** Why the session scope isn't every Turn; null when it is, or a Turn is shown. */
    note: narrowed === null ? note : null,
  };
};
