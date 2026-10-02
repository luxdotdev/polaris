/**
 * Which files agents are on (DESIGN.md, Editor; spec §5), from the session
 * feeds' Turn items: a Working session's file changes in its current Turn
 * (done or in progress), and the files a Needs You session is blocked on.
 */
import type { TurnItem } from "@polaris/protocol";
import { Predicate } from "effect";
import type { SessionEntry } from "../../../../store/hostModel.ts";
import type { SessionModel, TurnView } from "../../../../store/sessionModel.ts";
import { isUnder, resolve } from "./paths.ts";

/** Who is changing a file now, for the editor's Working strip (E3); `AgentEdit` in features/editor. */
export interface AgentEdit {
  readonly sessionId: string;
  readonly title: string;
  readonly harness: string;
  readonly turnId: string;
  /** 1-based, as copy says "turn N". */
  readonly turnIndex: number;
  readonly turnStartedAt: string;
  /** Turn items carry no times, so this stays null until the protocol has them. */
  readonly lastChangeAt: string | null;
  /** A file change for this path is in progress right now. */
  readonly live: boolean;
}

export interface AgentMarks {
  /** Absolute path → the Harness kind of the Working session changing it. */
  readonly editing: ReadonlyMap<string, string>;
  /** Absolute path → the session, Turn and state of that change. */
  readonly edits: ReadonlyMap<string, AgentEdit>;
  /** Absolute paths a session that needs you is blocked on. */
  readonly blocked: ReadonlySet<string>;
}

export const noAgents: AgentMarks = { editing: new Map(), edits: new Map(), blocked: new Set() };

/** Sessions whose feed tells us about files under `root`: Working or Needs You, working in it. */
export const watchedSessions = (
  entries: Iterable<SessionEntry>,
  workspaceId: string,
  root: string
): ReadonlyArray<SessionEntry> =>
  [...entries].filter(
    ({ session }) =>
      session.workspaceId === workspaceId &&
      (session.state === "working" || session.state === "needs-you") &&
      isUnder(session.cwd, root)
  );

type FileChangeItem = Extract<TurnItem, { _tag: "FileChange" }>;

const fileChanges = (item: TurnItem | null): ReadonlyArray<FileChangeItem> =>
  Predicate.isTagged(item, "FileChange") ? [item] : [];

/** The current Turn's file changes: completed, in progress, and its Subagents'. */
const turnChanges = (turn: TurnView): ReadonlyArray<FileChangeItem> => [
  ...turn.items.flatMap(fileChanges),
  ...[...turn.live.values()].flatMap((live) => fileChanges(live.item)),
  ...turn.subagents.flatMap((sub) => [
    ...sub.items.flatMap(fileChanges),
    ...[...sub.live.values()].flatMap((live) => fileChanges(live.item)),
  ]),
];

const pathsOf = (items: ReadonlyArray<FileChangeItem>, cwd: string, root: string) =>
  items
    .filter((item) => item.status !== "declined" && item.status !== "failed")
    .flatMap((item) => item.changes.map((change) => resolve(cwd, change.path)))
    .filter((path) => isUnder(path, root) && path !== root);

/**
 * Where a waiting session is blocked: the files its open file-change items name
 * (what an edit approval is about), else what its Turn changed before it stopped.
 */
const blockedPaths = (turn: TurnView, cwd: string, root: string) => {
  const open = pathsOf(
    [...turn.live.values()].flatMap((live) => fileChanges(live.item)),
    cwd,
    root
  );

  return open.length > 0 ? open : pathsOf(turnChanges(turn), cwd, root);
};

export interface AgentInput {
  readonly root: string;
  readonly sessions: ReadonlyArray<SessionEntry>;
  readonly feed: (sessionId: string) => SessionModel | undefined;
}

/** The paths a Working session's current Turn is changing, those still in progress marked live. */
const editsOf = (session: SessionEntry["session"], turn: TurnView, root: string) => {
  const live = new Set(
    pathsOf(
      [...turn.live.values()].flatMap((item) => fileChanges(item.item)),
      session.cwd,
      root
    )
  );

  return pathsOf(turnChanges(turn), session.cwd, root).map((path): [string, AgentEdit] => [
    path,
    {
      sessionId: session.id,
      title: session.title,
      harness: session.harness,
      turnId: turn.turn.id,
      turnIndex: turn.turn.index + 1,
      turnStartedAt: turn.turn.startedAt,
      lastChangeAt: null,
      live: live.has(path),
    },
  ]);
};

export const agentMarks = ({ root, sessions, feed }: AgentInput): AgentMarks => {
  const edits = new Map<string, AgentEdit>();
  const blocked = new Set<string>();

  for (const { session, pendingApprovals } of sessions) {
    const turn = feed(session.id)?.turns.at(-1);

    if (turn === undefined || turn.turn.status !== "working") continue;

    if (session.state === "working") {
      for (const [path, edit] of editsOf(session, turn, root)) edits.set(path, edit);
    } else if (pendingApprovals.length > 0) {
      for (const path of blockedPaths(turn, session.cwd, root)) blocked.add(path);
    }
  }

  const editing = new Map([...edits].map(([path, edit]) => [path, edit.harness] as const));

  return { editing, edits, blocked };
};
