/**
 * Which Turns wrote each line (ADR 0111), from the fingerprints its hash matched: only Turns
 * from before the line's commit count, and a line too common to identify takes the Origins of
 * the nearest identified lines around it in the same run of the same commit.
 */
import type { LineOrigin, OriginLine, OriginLineQuery, SessionId, TurnId } from "@polaris/protocol";

/** A fingerprint a line hash matched: the Turn that wrote it, and when (epoch ms). */
export interface FingerprintMatch {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly at: number;
}

/** git's commit times are whole seconds: a Turn in the commit's own second still came before it. */
export const COMMIT_TIME_GRACE_MS = 1_000;

const before = (match: FingerprintMatch, commitTime: number | null) =>
  commitTime === null || match.at < commitTime + COMMIT_TIME_GRACE_MS;

/** Matches grouped by session in the order first seen, each session's Turns oldest first. */
const group = (matches: ReadonlyArray<FingerprintMatch>): ReadonlyArray<LineOrigin> => {
  const sessions = new Map<SessionId, Map<TurnId, number>>();

  for (const match of matches) {
    const turns = sessions.get(match.sessionId) ?? new Map<TurnId, number>();
    turns.set(match.turnId, Math.min(turns.get(match.turnId) ?? match.at, match.at));
    sessions.set(match.sessionId, turns);
  }

  return [...sessions].map(([sessionId, turns]) => ({
    sessionId,
    turnIds: [...turns].sort((a, b) => a[1] - b[1]).map(([turnId]) => turnId),
  }));
};

type Own = ReadonlyArray<FingerprintMatch> | null;

/** Whether `next` continues `previous`'s run: the next line, from the same commit. */
const sameRun = (previous: OriginLineQuery, next: OriginLineQuery) =>
  next.line === previous.line + 1 && next.commitSha === previous.commitSha;

/** The nearest identified line's matches from `at` in direction `step`, within the run. */
const nearest = (
  lines: ReadonlyArray<OriginLineQuery>,
  own: ReadonlyArray<Own>,
  at: number,
  step: 1 | -1
): ReadonlyArray<FingerprintMatch> => {
  for (let i = at + step; i >= 0 && i < lines.length; i += step) {
    const [a, b] = step === 1 ? [lines[i - 1]!, lines[i]!] : [lines[i]!, lines[i + 1]!];

    if (!sameRun(a, b)) return [];
    const matches = own[i];

    if (matches !== null && matches !== undefined) return matches;
  }

  return [];
};

/** Each line's Origins, in the order the lines came. */
export const resolveOrigins = (
  lines: ReadonlyArray<OriginLineQuery>,
  matches: ReadonlyMap<string, ReadonlyArray<FingerprintMatch>>
): ReadonlyArray<OriginLine> => {
  const sorted = [...lines].sort((a, b) => a.line - b.line);

  const own: ReadonlyArray<Own> = sorted.map((line) =>
    line.hash === null
      ? null
      : (matches.get(line.hash) ?? []).filter((match) => before(match, line.commitTime))
  );

  const resolved = new Map<number, ReadonlyArray<LineOrigin>>();

  sorted.forEach((line, at) => {
    const found = own[at] ?? [...nearest(sorted, own, at, -1), ...nearest(sorted, own, at, 1)];

    resolved.set(line.line, group(found));
  });

  return lines.map((line) => ({ line: line.line, origins: resolved.get(line.line) ?? [] }));
};
