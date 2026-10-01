/**
 * The reactor for `AcceptTurns` with `revertLaterTurns`: the files the later
 * Turns changed go back to the accepted Turn's after-checkpoint, then
 * `TurnsReverted` records it.
 */
import { type Command, DomainEvent } from "@polaris/protocol";
import { Effect } from "effect";
import { findRepoRoot, resolveCommit } from "../git/git.ts";
import { ServiceError } from "../services.ts";
import type { EventStore } from "../store/EventStore.ts";
import { type LaterTurn, revertLaterTurns } from "./revert.ts";

type AcceptTurns = Extract<Command, { _tag: "AcceptTurns" }>;

const failed = (cause: unknown) =>
  new ServiceError({
    service: "accept",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const commitOf = async (root: string, ref: string | null) =>
  ref === null ? null : resolveCommit(root, ref);

export const revertAfterAccept = (store: EventStore["Service"], command: AcceptTurns) =>
  Effect.gen(function* () {
    if (!command.revertLaterTurns) return;
    const model = yield* store.model;
    const record = model.sessions.get(command.sessionId);

    if (record === undefined) return;

    const turns = yield* store.readTurns({
      sessionId: command.sessionId,
      beforeIndex: null,
      limit: null,
    });

    const through = turns.find((turn) => turn.id === command.throughTurnId);
    const later = turns.filter((turn) => through !== undefined && turn.index > through.index);

    if (through === undefined || later.length === 0 || through.checkpointAfter === null) return;
    const checkpoint = through.checkpointAfter;

    yield* Effect.tryPromise({
      try: async () => {
        const root = await findRepoRoot(record.session.cwd);
        const target = root === null ? null : await commitOf(root, checkpoint);

        if (root === null || target === null) return;
        const commits: Array<LaterTurn> = [];

        for (const turn of later) {
          const before = await commitOf(root, turn.checkpointBefore);
          const after = await commitOf(root, turn.checkpointAfter);

          if (before !== null && after !== null) commits.push({ before, after });
        }

        await revertLaterTurns(root, target, commits);
      },
      catch: failed,
    });

    yield* store.commit({
      commandId: null,
      decide: () =>
        Effect.succeed([
          DomainEvent.cases.TurnsReverted.make({
            sessionId: command.sessionId,
            toTurnId: through.id,
            revertedTurnIds: later.map((turn) => turn.id),
            checkpoint,
          }),
        ]),
    });
  });
