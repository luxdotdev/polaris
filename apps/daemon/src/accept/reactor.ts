/**
 * The reactor for `AcceptTurns` with `revertLaterTurns`: the files the later
 * Turns changed go back to the accepted Turn's after-checkpoint, then
 * `TurnsReverted` records it. Another Agent Session in the same checkout that
 * changed those files refuses it (`shared.ts`), at admission and again here.
 */
import { type Command, DomainEvent, type Turn } from "@polaris/protocol";
import { Effect } from "effect";
import { findRepoRoot, resolveCommit } from "../git/git.ts";
import { finishingGit, interruptibleGit } from "../git/interrupt.ts";
import { ServiceError } from "../services.ts";
import type { EventStore } from "../store/EventStore.ts";
import { changedPaths, type LaterTurn, revertLaterTurns } from "./revert.ts";
import { conflictReason, revertConflicts } from "./shared.ts";

type AcceptTurns = Extract<Command, { _tag: "AcceptTurns" }>;

type Store = EventStore["Service"];

const failed = (cause: unknown) =>
  new ServiceError({
    service: "accept",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const commitOf = async (root: string, ref: string | null) =>
  ref === null ? null : resolveCommit(root, ref);

interface RevertFiles {
  readonly root: string;
  readonly target: string;
  readonly commits: ReadonlyArray<LaterTurn>;
}

interface RevertPlan {
  readonly through: Turn;
  readonly checkpoint: string;
  readonly later: ReadonlyArray<Turn>;
  /** Null outside git, or when the checkpoint is gone: only the event is recorded. */
  readonly files: RevertFiles | null;
}

/** What reverting after `command` would restore; null when there's nothing to revert. */
const planRevert = (store: Store, command: AcceptTurns) =>
  Effect.gen(function* () {
    if (!command.revertLaterTurns) return null;
    const model = yield* store.model;
    const record = model.sessions.get(command.sessionId);

    if (record === undefined) return null;

    const turns = yield* store.readTurns({
      sessionId: command.sessionId,
      beforeIndex: null,
      limit: null,
    });

    const through = turns.find((turn) => turn.id === command.throughTurnId);
    const later = turns.filter((turn) => through !== undefined && turn.index > through.index);

    if (through === undefined || later.length === 0 || through.checkpointAfter === null) {
      return null;
    }

    const checkpoint = through.checkpointAfter;

    const files = yield* interruptibleGit({
      try: async (): Promise<RevertFiles | null> => {
        const root = await findRepoRoot(record.session.cwd);
        const target = root === null ? null : await commitOf(root, checkpoint);

        if (root === null || target === null) return null;
        const commits: Array<LaterTurn> = [];

        for (const turn of later) {
          const before = await commitOf(root, turn.checkpointBefore);
          const after = await commitOf(root, turn.checkpointAfter);

          if (before !== null && after !== null) commits.push({ before, after });
        }

        return { root, target, commits };
      },
      catch: failed,
    });

    return { through, checkpoint, later, files } satisfies RevertPlan;
  });

const refusalFor = (store: Store, command: AcceptTurns, plan: RevertPlan) =>
  Effect.gen(function* () {
    const { files } = plan;

    if (files === null) return null;
    const model = yield* store.model;

    return yield* interruptibleGit({
      try: async () =>
        conflictReason(
          await revertConflicts({
            root: files.root,
            sessionId: command.sessionId,
            after: plan.through.endedAt,
            paths: await changedPaths(files.root, files.commits),
            sessions: model.sessions.values(),
          })
        ),
      catch: failed,
    });
  });

/** Why reverting after `command` would clobber another Agent Session's work, or null. */
export const sharedRevertRefusal = (store: Store, command: AcceptTurns) =>
  Effect.gen(function* () {
    const plan = yield* planRevert(store, command);

    return plan === null ? null : yield* refusalFor(store, command, plan);
  });

export const revertAfterAccept = (store: Store, command: AcceptTurns) =>
  Effect.gen(function* () {
    const plan = yield* planRevert(store, command);

    if (plan === null) return;
    const refusal = yield* refusalFor(store, command, plan);

    if (refusal !== null) {
      return yield* Effect.logWarning(`not reverting the later Turns: ${refusal}`);
    }

    const { files } = plan;

    if (files !== null) {
      // It writes the work tree: an interrupt lets it finish rather than leave it half reverted.
      yield* finishingGit({
        try: () => revertLaterTurns(files.root, files.target, files.commits),
        catch: failed,
      });
    }

    yield* store.commit({
      commandId: null,
      decide: () =>
        Effect.succeed([
          DomainEvent.cases.TurnsReverted.make({
            sessionId: command.sessionId,
            toTurnId: plan.through.id,
            revertedTurnIds: plan.later.map((turn) => turn.id),
            checkpoint: plan.checkpoint,
          }),
        ]),
    });
  });
