/**
 * The Turns an accept works on: the session's Turns from the store, which of
 * them are already committed, and the commits their checkpoints point at.
 */
import {
  AcceptRefused,
  GitError,
  NotFound,
  type SessionId,
  type Turn,
  type TurnId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { findRepoRoot, GitCommandError, resolveCommit } from "../git/git.ts";
import type { EventStore } from "../store/EventStore.ts";
import type { SessionRecord } from "../store/model.ts";
import { type CheckpointedTurn, CommitRefused, committedTurnIds } from "./commit.ts";

type Store = EventStore["Service"];

export interface AcceptContext {
  readonly record: SessionRecord;
  readonly root: string;
  readonly turns: ReadonlyArray<Turn>;
  readonly through: Turn;
  /** Not yet committed, through `through`, oldest first. */
  readonly range: ReadonlyArray<Turn>;
  readonly later: ReadonlyArray<Turn>;
}

/** Git and refusal failures as the RPCs' errors. */
export const acceptFailure = (root: string) => (cause: unknown) => {
  if (cause instanceof CommitRefused) return new AcceptRefused({ reason: cause.message });

  const message =
    cause instanceof GitCommandError
      ? cause.message
      : cause instanceof Error
        ? cause.message
        : String(cause);

  return new GitError({ cwd: root, message });
};

export const tryGit = <A>(root: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: acceptFailure(root) });

/** The repository the session works in. */
export const sessionRoot = Effect.fn("accept.root")(function* (store: Store, sessionId: SessionId) {
  const model = yield* store.model;
  const record = model.sessions.get(sessionId);

  if (record === undefined) return yield* new NotFound({ what: "session", id: sessionId });
  const root = yield* Effect.promise(() => findRepoRoot(record.session.cwd));

  return root === null
    ? yield* new AcceptRefused({ reason: `${record.session.cwd} is not in a git repository` })
    : root;
});

export const loadAccept = Effect.fn("accept.load")(function* (
  store: Store,
  sessionId: SessionId,
  /** Null: through the latest Turn. */
  throughTurnId: TurnId | null
) {
  const model = yield* store.model;
  const record = model.sessions.get(sessionId);

  if (record === undefined) return yield* new NotFound({ what: "session", id: sessionId });

  const turns = yield* store
    .readTurns({ sessionId, beforeIndex: null, limit: null })
    .pipe(Effect.mapError((e) => new GitError({ cwd: record.session.cwd, message: e.message })));

  const through =
    throughTurnId === null ? turns.at(-1) : turns.find((turn) => turn.id === throughTurnId);

  if (through === undefined) {
    return yield* new NotFound({ what: "turn", id: throughTurnId ?? "latest" });
  }

  const root = yield* sessionRoot(store, sessionId);

  const committed = yield* tryGit(root, () => committedTurnIds(root, sessionId));

  const lastCommitted = Math.max(
    -1,
    ...turns.filter((t) => committed.has(t.id)).map((t) => t.index)
  );

  return {
    record,
    root,
    turns,
    through,
    range: turns.filter((t) => t.index > lastCommitted && t.index <= through.index),
    later: turns.filter((t) => t.index > through.index),
  } satisfies AcceptContext;
});

/** Each Turn's checkpoint commits; refused when one has none (a Turn in flight, or no git then). */
export const checkpointed = (root: string, turns: ReadonlyArray<Turn>) =>
  tryGit(root, async () => {
    const out: Array<CheckpointedTurn> = [];

    for (const turn of turns) {
      const before = turn.checkpointBefore && (await resolveCommit(root, turn.checkpointBefore));
      const after = turn.checkpointAfter && (await resolveCommit(root, turn.checkpointAfter));

      if (!before || !after) {
        throw new CommitRefused(`Turn ${turn.index + 1} has no checkpoint to commit from`);
      }

      out.push({ turnId: turn.id, index: turn.index, before, after });
    }

    return out;
  });
