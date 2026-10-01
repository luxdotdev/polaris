/**
 * Handlers for accepting an Agent Session's work (capability `session.accept`):
 * the plan, the drafted message, the commit and the push. The pull request is
 * the Client's (it holds the GitHub token); it links it with `LinkPullRequest`.
 */
import {
  AcceptBranch,
  AcceptCommitted,
  AcceptPlan,
  AcceptPushed,
  AcceptRefused,
  AcceptRemote,
  AcceptTurn,
  CommitAccepted,
  DraftAccept,
  GetAcceptPlan,
  PushAccepted,
  type SessionId,
  type TurnId,
  type TurnItem,
} from "@polaris/protocol";
import { Effect, Option } from "effect";
import { RpcGroup } from "effect/rpc";
import { gitText } from "../git/git.ts";
import { HarnessRegistry } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { finalReply } from "../engine/fork.ts";
import {
  branchExists,
  currentBranch,
  defaultBranch,
  diffStat,
  pushRemote,
  validBranchName,
} from "./branch.ts";
import { type CommitGroup, CommitRefused, commitTurns } from "./commit.ts";
import { draftAccept, templateDraft } from "./draft.ts";
import { pushBranch } from "./push.ts";
import { type AcceptContext, checkpointed, loadAccept, sessionRoot, tryGit } from "./turns.ts";

export class AcceptRpcs extends RpcGroup.make(
  GetAcceptPlan,
  DraftAccept,
  CommitAccepted,
  PushAccepted
) {}

type CommitPayload = typeof CommitAccepted.payloadSchema.Type;

const turnTitle = (prompt: string) => {
  const line = prompt.trim().split("\n")[0]?.trim() ?? "";

  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

const plan = (ctx: AcceptContext) =>
  Effect.gen(function* () {
    const { root, range } = ctx;
    const turns = yield* checkpointed(root, range);

    return yield* tryGit(root, async () => {
      const branch = await currentBranch(root);
      const remote = await pushRemote(root, branch);
      const stats = await Promise.all(turns.map((t) => diffStat(root, t.before, t.after)));

      const total =
        turns.length === 0 ? null : await diffStat(root, turns[0]!.before, turns.at(-1)!.after);

      return new AcceptPlan({
        sessionId: ctx.record.session.id,
        root,
        turns: turns.map(
          (t, i) =>
            new AcceptTurn({
              turnId: t.turnId,
              index: t.index,
              title: turnTitle(range[i]?.prompt ?? ""),
              files: stats[i]?.files ?? 0,
            })
        ),
        laterTurns: ctx.later.length,
        branch,
        defaultBranch: await defaultBranch(root, remote?.name ?? null),
        worktree: ctx.record.session.worktreeId !== null,
        remote: remote === null ? null : new AcceptRemote(remote),
        files: total?.files ?? 0,
        additions: total?.additions ?? 0,
        deletions: total?.deletions ?? 0,
      });
    });
  });

const refuse = (reason: string) => Effect.fail(new AcceptRefused({ reason }));

/** Why committing can't start, or null. */
const refusal = (ctx: AcceptContext): string | null => {
  const accepted = ctx.record.session.acceptedThroughIndex;

  if (ctx.turns.some((turn) => turn.status === "working")) {
    return "the session is working; wait for the Turn to end";
  }

  if (accepted === null || accepted < ctx.through.index) {
    return `accept the Turns through Turn ${ctx.through.index + 1} first`;
  }

  return ctx.range.length === 0
    ? `the Turns through Turn ${ctx.through.index + 1} are already committed`
    : null;
};

/** The branch to commit to, and the one to create first (null: commit to the current one). */
const targetBranch = (ctx: AcceptContext, requested: AcceptBranch) =>
  Effect.gen(function* () {
    const { root } = ctx;
    const current = yield* tryGit(root, () => currentBranch(root));

    // A Worktree session always commits to its Worktree's branch.
    const create =
      ctx.record.session.worktreeId !== null || AcceptBranch.guards.Current(requested)
        ? null
        : requested.name.trim();

    if (create === null) {
      return current === null
        ? yield* refuse("HEAD is detached; commit to a new branch instead")
        : { branch: current, create: null };
    }

    if (!(yield* tryGit(root, () => validBranchName(root, create)))) {
      return yield* refuse(`"${create}" isn't a valid branch name`);
    }

    if (yield* tryGit(root, () => branchExists(root, create))) {
      return yield* refuse(`a branch named ${create} already exists`);
    }

    return { branch: create, create };
  });

const message = (title: string, body: string) =>
  body.trim() === "" ? `${title.trim()}\n` : `${title.trim()}\n\n${body.trim()}\n`;

const commit = (ctx: AcceptContext, payload: CommitPayload) =>
  Effect.gen(function* () {
    const reason = refusal(ctx);

    if (reason !== null) return yield* refuse(reason);

    if (payload.title.trim() === "") return yield* refuse("the commit message is empty");
    const turns = yield* checkpointed(ctx.root, ctx.range);
    const target = yield* targetBranch(ctx, payload.branch);

    const groups: ReadonlyArray<CommitGroup> =
      payload.granularity === "single"
        ? [{ turns, message: message(payload.title, payload.body) }]
        : turns.map((turn, i) => ({
            turns: [turn],
            message: message(payload.turnTitles[i]?.trim() || payload.title, ""),
          }));

    const { root } = ctx;

    return yield* tryGit(root, async () => {
      const commits = await commitTurns({
        root,
        sessionId: ctx.record.session.id,
        groups,
        createBranch: target.create,
      });

      const remote = await pushRemote(root, target.branch);
      const base = await defaultBranch(root, remote?.name ?? null);

      return new AcceptCommitted({
        branch: target.branch,
        commits,
        base: base === target.branch ? null : base,
      });
    });
  });

const draft = (ctx: AcceptContext) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const registry = yield* HarnessRegistry;
    const model = yield* store.model;
    const turns = yield* checkpointed(ctx.root, ctx.range);
    const first = turns[0];
    const last = turns.at(-1);

    if (first === undefined || last === undefined) {
      return yield* refuse(`the Turns through Turn ${ctx.through.index + 1} are already committed`);
    }

    const items = yield* store
      .readTurnItems({ turnIds: ctx.range.map((t) => t.id), upTo: model.sequence })
      .pipe(Effect.orElseSucceed(() => new Map<TurnId, ReadonlyArray<TurnItem>>()));

    const stat = yield* tryGit(ctx.root, () =>
      gitText(ctx.root, ["diff", "--stat=100", first.before, last.after, "--"])
    );

    const driver = yield* registry.get(ctx.record.session.harness).pipe(Effect.option);

    const input = {
      session: ctx.record.session,
      turns: ctx.range.map((t) => ({
        index: t.index,
        prompt: t.prompt,
        reply: finalReply(items.get(t.id)),
      })),
      stat,
    };

    return yield* Option.match(driver, {
      onNone: () =>
        Effect.succeed(templateDraft(input, "the session's Harness isn't on this Host")),
      onSome: (found) => draftAccept(found, ctx.root, input),
    });
  });

const push = (root: string, branch: string) =>
  tryGit(root, async () => {
    if (!(await branchExists(root, branch)))
      throw new CommitRefused(`there is no branch ${branch}`);
    const remote = await pushRemote(root, branch);

    if (remote === null) throw new CommitRefused("the repository has no remote to push to");
    await pushBranch(root, remote, branch);

    return new AcceptPushed({ remote: new AcceptRemote(remote), branch });
  });

export const AcceptRpcsLive = AcceptRpcs.toLayer(
  Effect.gen(function* () {
    const store = yield* EventStore;
    const registry = yield* HarnessRegistry;

    const withContext =
      <A, E>(f: (ctx: AcceptContext) => Effect.Effect<A, E, EventStore | HarnessRegistry>) =>
      (payload: { readonly sessionId: SessionId; readonly throughTurnId: TurnId }) =>
        loadAccept(store, payload.sessionId, payload.throughTurnId).pipe(
          Effect.flatMap(f),
          Effect.provideService(EventStore, store),
          Effect.provideService(HarnessRegistry, registry)
        );

    return {
      "session.acceptPlan": withContext(plan),
      "session.draftAccept": withContext(draft),
      "session.commitAccepted": (payload) => withContext((ctx) => commit(ctx, payload))(payload),
      "session.pushAccepted": ({ sessionId, branch }) =>
        sessionRoot(store, sessionId).pipe(Effect.flatMap((root) => push(root, branch))),
    };
  })
);
