/**
 * Origins (ENG-932, ADR 0111): the Agent Sessions and Turns that wrote a line or a commit, from
 * the line fingerprints each Turn's checkpoints leave. The RPCs and the MCP `origins` tool use it.
 */
import {
  GitError,
  type LineOrigin,
  NotFound,
  type OriginLine,
  type OriginLineQuery,
  type OriginSession,
  type SessionId,
  type Turn,
  type TurnId,
  type Workspace,
  type WorkspaceId,
  type WorktreeId,
} from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import { blameLines, pathInside } from "../git/blame.ts";
import { interruptibleGit } from "../git/interrupt.ts";
import { EventStore } from "../store/EventStore.ts";
import { commitAddedLines, findRepoKey } from "./git.ts";
import { indexing } from "./indexer.ts";
import { lineHash } from "./lineHash.ts";
import { type FingerprintMatch, resolveOrigins } from "./resolve.ts";

export { OriginsConfig } from "./indexer.ts";

/** How much of a Turn's prompt an Origin carries. */
export const ORIGIN_PROMPT_CHARACTERS = 280;

export interface BlameRequest {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId?: WorktreeId | null;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface Blamed {
  readonly repoKey: string;
  readonly lines: ReadonlyArray<{
    readonly line: number;
    readonly path: string;
    readonly hash: string | null;
    readonly commit: {
      readonly sha: string;
      readonly subject: string;
      readonly authorName: string;
      readonly authorEmail: string;
      readonly time: number;
    } | null;
  }>;
}

export interface Matched {
  readonly lines: ReadonlyArray<OriginLine>;
  readonly sessions: ReadonlyArray<OriginSession>;
}

export class Origins extends Context.Service<
  Origins,
  {
    readonly blame: (request: BlameRequest) => Effect.Effect<Blamed, NotFound | GitError>;
    /** Each line's Origins from this Host's fingerprints of `repoKey`. */
    readonly match: (
      repoKey: string,
      lines: ReadonlyArray<OriginLineQuery>
    ) => Effect.Effect<Matched>;
    readonly forCommit: (
      workspaceId: WorkspaceId,
      sha: string
    ) => Effect.Effect<ReadonlyArray<OriginSession>, NotFound | GitError>;
    /** Fingerprints one Turn now (the follower and backfill do this on their own); false if git failed. */
    readonly indexTurn: (
      sessionId: SessionId,
      turnId: TurnId,
      at: number
    ) => Effect.Effect<boolean>;
    /** Deletes a session's fingerprints, as deleting the Agent Session must. */
    readonly forgetSession: (sessionId: SessionId) => Effect.Effect<void>;
    /** Once this start's backfill has ended: how many Turns it failed on (0 when it is done). */
    readonly backfillFinished: Effect.Effect<number>;
  }
>()("polaris/daemon/origins/Origins") {
  /** Also follows new checkpoints and runs the upgrade's backfill for as long as it lives. */
  static readonly layer = Layer.effect(
    Origins,
    Effect.suspend(() => make)
  );
}

const gitError = (cwd: string) => (cause: unknown) =>
  new GitError({ cwd, message: cause instanceof Error ? cause.message : String(cause) });

/** The conversation's number for a Turn (its user Turn's); a Daemon before user Turns counts each. */
const turnNumber = (turn: Turn | null) =>
  turn === null ? 0 : (turn.userTurnNumber ?? turn.index + 1);

const cutPrompt = (prompt: string) => {
  const chars = Array.from(prompt);

  return chars.length > ORIGIN_PROMPT_CHARACTERS
    ? chars.slice(0, ORIGIN_PROMPT_CHARACTERS).join("")
    : prompt;
};

const make = Effect.gen(function* () {
  const store = yield* EventStore;
  // Root commits never change for a repository: one walk per Workspace for the Daemon's life.
  const repoKeys = new Map<WorkspaceId, string>();

  const repoKeyOf = (workspace: Workspace) =>
    Effect.gen(function* () {
      const known = repoKeys.get(workspace.id);

      if (known !== undefined) return known;

      const key = yield* interruptibleGit({
        try: () => findRepoKey(workspace.path),
        catch: gitError(workspace.path),
      });

      if (key !== null) repoKeys.set(workspace.id, key);

      return key;
    });

  const workspaceOf = (workspaceId: WorkspaceId) =>
    Effect.flatMap(store.model, (model) => {
      const workspace = model.workspaces.get(workspaceId);

      return workspace === undefined
        ? Effect.fail(new NotFound({ what: "workspace", id: workspaceId }))
        : Effect.succeed(workspace);
    });

  const repoKeyOrFail = (workspace: Workspace) =>
    Effect.flatMap(repoKeyOf(workspace), (key) =>
      key === null
        ? Effect.fail(
            new GitError({ cwd: workspace.path, message: "the repository has no commits yet" })
          )
        : Effect.succeed(key)
    );

  /** The Workspace's checkout, or that Worktree of it. */
  const checkoutOf = (workspace: Workspace, worktreeId: WorktreeId | null | undefined) =>
    Effect.flatMap(store.model, (model) => {
      if (worktreeId === null || worktreeId === undefined) return Effect.succeed(workspace.path);
      const worktree = model.worktrees.get(worktreeId);

      return worktree?.workspaceId === workspace.id
        ? Effect.succeed(worktree.path)
        : Effect.fail(new NotFound({ what: "worktree", id: worktreeId }));
    });

  const blame = (request: BlameRequest) =>
    Effect.gen(function* () {
      const workspace = yield* workspaceOf(request.workspaceId);
      const checkout = yield* checkoutOf(workspace, request.worktreeId);
      const path = pathInside(checkout, request.path);

      if (path === null) return yield* new NotFound({ what: "file", id: request.path });
      const repoKey = yield* repoKeyOrFail(workspace);

      const lines = yield* interruptibleGit({
        try: () => blameLines(checkout, path, request.startLine, request.endLine),
        catch: gitError(checkout),
      });

      return {
        repoKey,
        lines: lines.map(({ line, path, text, commit }) => ({
          line,
          path,
          hash: lineHash(text),
          commit,
        })),
      };
    });

  /** The matched sessions as the hover shows them, with the Turns that matched. */
  const describe = (
    origins: ReadonlyArray<LineOrigin>,
    times: ReadonlyMap<string, number>
  ): Effect.Effect<ReadonlyArray<OriginSession>> =>
    Effect.gen(function* () {
      const model = yield* store.model;
      const turnsOf = new Map<SessionId, Set<TurnId>>();

      for (const { sessionId, turnIds } of origins) {
        const set = turnsOf.get(sessionId) ?? new Set();

        for (const turnId of turnIds) set.add(turnId);
        turnsOf.set(sessionId, set);
      }

      const sessions: Array<OriginSession> = [];

      for (const [sessionId, turnIds] of turnsOf) {
        const record = model.sessions.get(sessionId);

        if (record === undefined) continue;

        const turns = yield* Effect.forEach([...turnIds], (turnId) =>
          store.readTurn({ sessionId, turnId }).pipe(
            Effect.map((turn) => ({
              turnId,
              number: turnNumber(turn),
              time: times.get(turnId) ?? 0,
              prompt: cutPrompt(turn?.prompt ?? ""),
            })),
            Effect.orElseSucceed(() => ({
              turnId,
              number: 0,
              time: times.get(turnId) ?? 0,
              prompt: "",
            }))
          )
        );

        const { session } = record;

        sessions.push({
          sessionId,
          workspaceId: session.workspaceId,
          title: session.title,
          harness: session.harness,
          sessionState: session.state,
          archived: session.state === "archived",
          celestial: session.celestial ?? null,
          turns: turns.sort((a, b) => a.time - b.time),
        });
      }

      return sessions;
    });

  const turnTimes = (matches: ReadonlyMap<string, ReadonlyArray<FingerprintMatch>>) => {
    const times = new Map<string, number>();

    for (const list of matches.values())
      for (const { turnId, at } of list) times.set(turnId, Math.min(times.get(turnId) ?? at, at));

    return times;
  };

  const match = (repoKey: string, lines: ReadonlyArray<OriginLineQuery>) =>
    Effect.gen(function* () {
      const keys = lines.flatMap(({ hash, path }) =>
        hash === null ? [] : [{ lineHash: hash, path }]
      );

      const matches = yield* store.origins.match(repoKey, keys);
      const resolved = resolveOrigins(lines, matches);

      const sessions = yield* describe(
        resolved.flatMap((line) => line.origins),
        turnTimes(matches)
      );

      const known = new Set(sessions.map((s) => s.sessionId));

      return {
        lines: resolved.map((line) => ({
          line: line.line,
          origins: line.origins.filter((origin) => known.has(origin.sessionId)),
        })),
        sessions,
      };
    });

  const forCommit = (workspaceId: WorkspaceId, sha: string) =>
    Effect.gen(function* () {
      const workspace = yield* workspaceOf(workspaceId);
      const repoKey = yield* repoKeyOrFail(workspace);

      const commit = yield* interruptibleGit({
        try: () => commitAddedLines(workspace.path, sha),
        catch: gitError(workspace.path),
      });

      const lines = commit.added.flatMap(({ path, text }, at) => {
        const hash = lineHash(text);

        return hash === null
          ? []
          : [{ line: at + 1, path, hash, commitSha: sha, commitTime: commit.time }];
      });

      return (yield* match(repoKey, lines)).sessions;
    });

  const indexer = yield* indexing(repoKeyOf);

  yield* Effect.forkScoped(indexer.follow);
  yield* Effect.forkScoped(indexer.backfill);

  return {
    blame,
    match,
    forCommit,
    indexTurn: indexer.indexTurn,
    backfillFinished: indexer.backfillFinished,
    forgetSession: store.origins.dropSession,
  };
});
