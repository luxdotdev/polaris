/**
 * Output's default diff scope: the whole Agent Session, from its first Turn's checkpoint
 * to its latest's (`git.diff` with the Turns spec). The Turn menu narrows it to one Turn.
 */
import type { SessionId, TurnId } from "@polaris/protocol";
import { useEffect, useMemo, useState } from "react";
import type { TurnView } from "../../../store/sessionModel.ts";
import { polaris } from "../../bridge.ts";
import { useHost } from "../hooks.ts";
import {
  groupOf,
  groupSpan,
  groupTurns,
  type TurnGroup,
  type TurnSpan,
} from "../model/turnGroups.ts";
import { spanDiffable } from "../turnDiff.ts";

/** Each session's first Turn, once fetched: it never changes. */
const firsts = new Map<string, TurnId>();

/** The session's first Turn, asked of the Host when only later pages are loaded. */
const fetchFirst = async (hostKey: string, sessionId: SessionId): Promise<TurnId | null> => {
  const result = await polaris().request("session.turns", {
    hostKey,
    sessionId,
    beforeIndex: 1,
    limit: 1,
  });

  return result.ok ? (result.value.turns[0]?.turn.id ?? null) : null;
};

/** The span of every Turn in the session; null before it has one. */
export const useSessionSpan = (
  hostKey: string,
  sessionId: SessionId,
  turns: ReadonlyArray<TurnView>
): TurnSpan | null => {
  const key = `${hostKey}\u0000${sessionId}`;
  const loaded = turns[0]?.turn ?? null;
  const last = turns.at(-1)?.turn.id ?? null;
  const missing = loaded !== null && loaded.index > 0 && !firsts.has(key);
  const [, setFetched] = useState(0);

  useEffect(() => {
    if (!missing) return undefined;
    let live = true;

    void fetchFirst(hostKey, sessionId).then((id) => {
      if (id !== null) firsts.set(key, id);

      if (live) setFetched((n) => n + 1);
    });

    return () => {
      live = false;
    };
  }, [missing, hostKey, sessionId, key]);

  if (loaded === null || last === null) return null;
  const first = loaded.index === 0 ? loaded.id : firsts.get(key);

  // Until the first Turn is known, or if the Host won't say, the loaded Turns stand in.
  return { first: first ?? loaded.id, last };
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
  const sessionSpan = useSessionSpan(hostKey, sessionId, turns);
  const everyTurn = useMemo(() => wholeSession(groups, turns), [groups, turns]);
  // A Daemon without `git.diff-turns` diffs one Turn at a time: it keeps the latest as the default.
  const whole = sessionSpan !== null && spanDiffable(sessionSpan, host);
  const narrowed = groupOf(groups, diffTurnId) ?? (whole ? null : (groups.at(-1) ?? null));

  return {
    groups,
    /** The Turn shown; null shows the whole session. */
    narrowed,
    whole,
    /** The Turns the diff covers, as a group (Comments, the diff's revision). */
    shown: narrowed ?? everyTurn,
    span: narrowed === null ? sessionSpan : groupSpan(narrowed),
  };
};
