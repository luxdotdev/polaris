// Portions adapted from pingdotgg/t3code@de34391 (MIT)
/**
 * Before reverting later Turns: the other Agent Sessions working in the same
 * checkout whose Turns since the accepted one changed files the revert would
 * restore. Restoring those files would clobber their work, so the revert is
 * refused at admission and checked again before writing.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type { AgentSession, SessionId, Timestamp, Turn } from "@polaris/protocol";
import { gitText, resolveCommit } from "../git/git.ts";
import { splitPaths } from "./revert.ts";

export interface RevertConflict {
  readonly sessionId: SessionId;
  readonly title: string;
  /** The overlapping files; empty when the session's changes can't be read. */
  readonly paths: ReadonlyArray<string>;
}

/** `child` is `parent` or inside it. */
export const contains = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);

  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

type OtherTurn = Pick<Turn, "checkpointBefore" | "checkpointAfter" | "endedAt">;

/** The part of a `SessionRecord` the check reads. */
export interface OtherSession {
  readonly session: Pick<AgentSession, "id" | "title" | "cwd">;
  readonly turns: ReadonlyArray<OtherTurn>;
}

/** Ended at or after `since`, or still running; null `since` counts every Turn. */
const since = (turn: OtherTurn, after: Timestamp | null) =>
  turn.endedAt === null || after === null || Date.parse(turn.endedAt) >= Date.parse(after);

/** The files `turn` changed; to the working tree while it runs. Null: no checkpoint to read. */
const turnPaths = async (root: string, turn: OtherTurn): Promise<ReadonlySet<string> | null> => {
  const before = turn.checkpointBefore && (await resolveCommit(root, turn.checkpointBefore));

  if (!before) return null;
  const after = turn.checkpointAfter && (await resolveCommit(root, turn.checkpointAfter));
  const diff = ["diff", "--name-only", "-z", "--no-renames", before];

  if (after) return new Set(splitPaths(await gitText(root, [...diff, after, "--"])));
  const tracked = await gitText(root, [...diff, "--"]);
  const untracked = await gitText(root, ["ls-files", "--others", "--exclude-standard", "-z"]);

  return new Set([...splitPaths(tracked), ...splitPaths(untracked)]);
};

const overlap = async (
  root: string,
  turns: ReadonlyArray<OtherTurn>,
  paths: ReadonlySet<string>
): Promise<ReadonlyArray<string> | null> => {
  const found = new Set<string>();

  for (const turn of turns) {
    const touched = await turnPaths(root, turn);

    if (touched === null) return [];

    for (const path of touched) if (paths.has(path)) found.add(path);
  }

  return found.size === 0 ? null : [...found].sort();
};

/**
 * The other sessions whose directory contains `root` or sits inside it, and
 * whose Turns ended at or after `after` (or still run) changed any of `paths`.
 */
export const revertConflicts = async (input: {
  readonly root: string;
  readonly sessionId: SessionId;
  readonly after: Timestamp | null;
  readonly paths: ReadonlySet<string>;
  readonly sessions: Iterable<OtherSession>;
}): Promise<ReadonlyArray<RevertConflict>> => {
  const root = real(input.root) ?? input.root;
  const conflicts: Array<RevertConflict> = [];

  if (input.paths.size === 0) return conflicts;

  for (const record of input.sessions) {
    const { session } = record;
    const cwd = session.id === input.sessionId ? null : real(session.cwd);

    if (cwd === null || !(contains(root, cwd) || contains(cwd, root))) continue;
    const turns = record.turns.filter((turn) => since(turn, input.after));
    const paths = await overlap(root, turns, input.paths);

    if (paths !== null) conflicts.push({ sessionId: session.id, title: session.title, paths });
  }

  return conflicts;
};

const SHOWN_PATHS = 3;

const described = ({ title, paths }: RevertConflict) => {
  const name = `"${title.trim() || "Untitled"}"`;

  if (paths.length === 0) return `${name}, whose changes can't be read`;
  const more = paths.length - SHOWN_PATHS;
  const listed = paths.slice(0, SHOWN_PATHS).join(", ");

  return `${name}: ${more > 0 ? `${listed} and ${more} more` : listed}`;
};

/** Why the revert is refused, for the user; null when nothing overlaps. */
export const conflictReason = (conflicts: ReadonlyArray<RevertConflict>): string | null => {
  if (conflicts.length === 0) return null;
  const who = conflicts.length === 1 ? "another Agent Session" : "other Agent Sessions";

  return (
    `${who} in this checkout changed files the revert would restore ` +
    `(${conflicts.map(described).join("; ")}); ` +
    "accept without reverting the later Turns, or run the sessions in separate Worktrees"
  );
};
