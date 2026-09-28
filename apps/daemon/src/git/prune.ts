/**
 * Pruning of per-Turn checkpoint refs
 * (`refs/polaris/checkpoints/<session>/<turn>/{before,after}`).
 *
 * Every Turn leaves two refs, and every ref pins a commit plus the trees and
 * blobs of a full working-tree snapshot, so a busy Workspace would otherwise
 * grow without bound. The policy keeps whatever a user can still act on:
 *
 * - **A session that is not Archived keeps every checkpoint.** Any Turn's diff
 *   can be reviewed, any Turn can be forked.
 * - **An Archived session keeps everything for `compactAfterMs`** (7 days by
 *   default). Archive is reversible (Unarchive) and a Fork may start from any
 *   Turn of an Archived session, so nothing goes right away.
 * - **Then it is compacted**: only the first Turn's `before` and the last
 *   Turn's `after` stay (the whole session's diff, which is what a later
 *   Review of the work compares), plus both refs of every pinned Turn (a Turn
 *   another Agent Session forked from).
 * - **After `dropAfterMs`** (30 days) all its refs go, **unless its Worktree's
 *   branch still exists and is not merged** into the main worktree's HEAD:
 *   that work may still be reviewed, so the compacted endpoints are kept for
 *   as long as the branch is unmerged.
 * - **Refs of sessions the caller does not list** (orphans, e.g. after the
 *   event store was reset) are reported and kept, unless `pruneOrphans`.
 *
 * Deleting a ref only makes the snapshot unreachable; git's own `gc` (which
 * runs automatically) reclaims the objects later. Polaris never runs `gc` in a
 * user's repository.
 */
import { Duration, Effect, Schedule } from "effect";
import { ServiceError } from "../services.ts";
import { gitText, runGitRaw } from "./git.ts";

export const CHECKPOINT_REF_PREFIX = "refs/polaris/checkpoints/";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckpointPolicy {
  /** How long an Archived session keeps every checkpoint. */
  readonly compactAfterMs: number;
  /** How long until an Archived session loses all of them (unless its branch is unmerged). */
  readonly dropAfterMs: number;
}

export const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
  compactAfterMs: 7 * DAY_MS,
  dropAfterMs: 30 * DAY_MS,
};

/** What the engine knows about one Agent Session of the repository. */
export interface CheckpointSession {
  readonly sessionId: string;
  /** When the session was Archived (epoch ms), or null while it is not Archived. */
  readonly archivedAt: number | null;
  /** Turn ids, oldest first. Turns missing here are ordered by checkpoint time. */
  readonly turnIds?: ReadonlyArray<string>;
  /** Turns whose checkpoints must survive compaction (e.g. another session forked from them). */
  readonly pinnedTurnIds?: ReadonlyArray<string>;
  /** The branch of the Worktree this session created, if any. */
  readonly worktreeBranch?: string | null;
}

export interface CheckpointRef {
  readonly ref: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly label: "before" | "after";
  readonly commit: string;
  /** Committer time of the checkpoint commit, epoch seconds. */
  readonly time: number;
}

/** Parses `refs/polaris/checkpoints/<session>/<turn>/<label>`; null for anything else. */
export const parseCheckpointRef = (
  ref: string
): Pick<CheckpointRef, "sessionId" | "turnId" | "label"> | null => {
  if (!ref.startsWith(CHECKPOINT_REF_PREFIX)) return null;
  const parts = ref.slice(CHECKPOINT_REF_PREFIX.length).split("/");

  if (parts.length < 3) return null;
  const label = parts.at(-1);

  if (label !== "before" && label !== "after") return null;
  const turnId = parts.at(-2)!;
  const sessionId = parts.slice(0, -2).join("/");

  if (turnId === "" || sessionId === "") return null;

  return { sessionId, turnId, label };
};

/** Every checkpoint ref of the repository containing `repoPath`. */
export const listCheckpointRefs = async (repoPath: string): Promise<Array<CheckpointRef>> => {
  const out = await gitText(repoPath, [
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(committerdate:unix)",
    CHECKPOINT_REF_PREFIX,
  ]);

  const refs: Array<CheckpointRef> = [];

  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [ref = "", commit = "", time = "0"] = line.split("\0");
    const parsed = parseCheckpointRef(ref);

    if (parsed !== null) refs.push({ ref, commit, time: Number(time) || 0, ...parsed });
  }

  return refs;
};

export type SessionVerdict =
  | "live" // not Archived: keep all
  | "grace" // Archived recently: keep all
  | "compact" // keep endpoints and pinned Turns
  | "protected" // past the drop age but its branch is unmerged: keep endpoints and pinned Turns
  | "drop" // delete all
  | "orphan"; // unknown to the caller

export interface PrunePlan {
  readonly delete: ReadonlyArray<string>;
  readonly keep: ReadonlyArray<string>;
  readonly sessions: ReadonlyMap<string, SessionVerdict>;
}

export interface PlanInput {
  readonly refs: ReadonlyArray<CheckpointRef>;
  readonly sessions: ReadonlyArray<CheckpointSession>;
  readonly now: number;
  readonly policy?: CheckpointPolicy;
  /** Worktree branches that still exist and are not merged (computed by `pruneCheckpoints`). */
  readonly unmergedBranches?: ReadonlySet<string>;
  readonly pruneOrphans?: boolean;
}

/** Refs to keep when compacting one session: first `before`, last `after`, pinned Turns. */
const compactKeep = (
  refs: ReadonlyArray<CheckpointRef>,
  session: CheckpointSession
): Set<string> => {
  const order = new Map((session.turnIds ?? []).map((id, index) => [id, index]));
  const turns = new Map<string, { time: number; refs: Array<CheckpointRef> }>();

  for (const ref of refs) {
    const turn = turns.get(ref.turnId) ?? { time: Number.POSITIVE_INFINITY, refs: [] };
    turn.time = Math.min(turn.time, ref.time);
    turn.refs.push(ref);
    turns.set(ref.turnId, turn);
  }

  // Known Turns in the engine's order; unknown ones by checkpoint time, then id.
  const sorted = [...turns.entries()].sort(([a, ta], [b, tb]) => {
    const oa = order.get(a);
    const ob = order.get(b);

    if (oa !== undefined && ob !== undefined) return oa - ob;

    if (ta.time !== tb.time) return ta.time - tb.time;

    return a < b ? -1 : a > b ? 1 : 0;
  });

  const keep = new Set<string>();
  // The earliest `before` and the latest `after` that exist (a Turn may lack one).
  const firstBefore = sorted.flatMap(([, t]) => t.refs.filter((r) => r.label === "before"))[0];
  const lastAfter = sorted.flatMap(([, t]) => t.refs.filter((r) => r.label === "after")).at(-1);

  if (firstBefore) keep.add(firstBefore.ref);

  if (lastAfter) keep.add(lastAfter.ref);
  const pinned = new Set(session.pinnedTurnIds ?? []);

  for (const ref of refs) if (pinned.has(ref.turnId)) keep.add(ref.ref);

  return keep;
};

/** The pure policy: which refs go. Every branch is unit-tested. */
export const planCheckpointPrune = (input: PlanInput): PrunePlan => {
  const policy = input.policy ?? DEFAULT_CHECKPOINT_POLICY;
  const known = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const bySession = new Map<string, Array<CheckpointRef>>();

  for (const ref of input.refs) {
    const list = bySession.get(ref.sessionId) ?? [];
    list.push(ref);
    bySession.set(ref.sessionId, list);
  }

  const del: Array<string> = [];
  const keep: Array<string> = [];
  const verdicts = new Map<string, SessionVerdict>();

  for (const [sessionId, refs] of bySession) {
    const session = known.get(sessionId);
    let verdict: SessionVerdict;

    if (session === undefined) verdict = "orphan";
    else if (session.archivedAt === null) verdict = "live";
    else {
      const age = input.now - session.archivedAt;

      const unmerged =
        session.worktreeBranch != null &&
        (input.unmergedBranches?.has(session.worktreeBranch) ?? false);

      if (age < policy.compactAfterMs) verdict = "grace";
      else if (age < policy.dropAfterMs) verdict = "compact";
      else verdict = unmerged ? "protected" : "drop";
    }

    verdicts.set(sessionId, verdict);

    const kept =
      verdict === "live" || verdict === "grace" || (verdict === "orphan" && !input.pruneOrphans)
        ? new Set(refs.map((r) => r.ref))
        : verdict === "compact" || verdict === "protected"
          ? compactKeep(refs, session!)
          : new Set<string>();

    for (const ref of refs) (kept.has(ref.ref) ? keep : del).push(ref.ref);
  }

  return { delete: del.sort(), keep: keep.sort(), sessions: verdicts };
};

/** Worktree branches (of `sessions`) that exist and are not an ancestor of the main HEAD. */
const findUnmergedBranches = async (
  repoPath: string,
  sessions: ReadonlyArray<CheckpointSession>
): Promise<Set<string>> => {
  const branches = new Set(sessions.flatMap((s) => (s.worktreeBranch ? [s.worktreeBranch] : [])));
  const unmerged = new Set<string>();

  if (branches.size === 0) return unmerged;

  // The main worktree's HEAD is what "merged" means for a Workspace.
  const commonDir = await gitText(repoPath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);

  const mainHead = await runGitRaw(repoPath, [
    "--git-dir",
    commonDir,
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD^{commit}",
  ]);

  const head = mainHead.code === 0 ? new TextDecoder().decode(mainHead.stdout).trim() : null;

  for (const branch of branches) {
    const ref = `refs/heads/${branch}`;
    const exists = await runGitRaw(repoPath, ["show-ref", "--verify", "--quiet", ref]);

    if (exists.code !== 0) continue;

    if (head === null) {
      unmerged.add(branch);
      continue;
    }

    const merged = await runGitRaw(repoPath, ["merge-base", "--is-ancestor", ref, head]);

    if (merged.code !== 0) unmerged.add(branch);
  }

  return unmerged;
};

/** Delete refs in one transaction (all or nothing). */
export const deleteRefs = async (repoPath: string, refs: ReadonlyArray<string>): Promise<void> => {
  if (refs.length === 0) return;
  await gitText(repoPath, ["update-ref", "--stdin"], {
    stdin: `${refs.map((ref) => `delete ${ref}`).join("\n")}\n`,
  });
};

export interface PruneReport {
  readonly repoPath: string;
  readonly deleted: ReadonlyArray<string>;
  readonly kept: number;
  readonly sessions: ReadonlyMap<string, SessionVerdict>;
}

export interface PruneOptions {
  readonly now?: number;
  readonly policy?: CheckpointPolicy;
  readonly pruneOrphans?: boolean;
  /** Compute and report, but delete nothing. */
  readonly dryRun?: boolean;
}

/**
 * Apply the policy to the repository containing `repoPath`. `sessions` should
 * list every Agent Session of the Workspace the engine knows about; refs of
 * sessions not listed are orphans and are kept unless `pruneOrphans`.
 */
export const pruneCheckpoints = async (
  repoPath: string,
  sessions: ReadonlyArray<CheckpointSession>,
  options: PruneOptions = {}
): Promise<PruneReport> => {
  const refs = await listCheckpointRefs(repoPath);
  const unmergedBranches = await findUnmergedBranches(repoPath, sessions);

  const plan = planCheckpointPrune({
    refs,
    sessions,
    now: options.now ?? Date.now(),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    unmergedBranches,
    pruneOrphans: options.pruneOrphans ?? false,
  });

  if (!options.dryRun) await deleteRefs(repoPath, plan.delete);

  return { repoPath, deleted: plan.delete, kept: plan.keep.length, sessions: plan.sessions };
};

/**
 * Delete every checkpoint of one session at once, e.g. when its Workspace is
 * removed. `onSessionArchived` below is the policy-driven variant.
 */
export const dropSessionCheckpoints = async (
  repoPath: string,
  sessionId: string
): Promise<ReadonlyArray<string>> => {
  const refs = (await listCheckpointRefs(repoPath)).filter((r) => r.sessionId === sessionId);
  await deleteRefs(
    repoPath,
    refs.map((r) => r.ref)
  );

  return refs.map((r) => r.ref);
};

const toServiceError = (cause: unknown) =>
  new ServiceError({
    service: "Checkpoints",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** `pruneCheckpoints` as an Effect. */
export const pruneCheckpointsEffect = Effect.fn("Checkpoints.prune")(function* (
  repoPath: string,
  sessions: ReadonlyArray<CheckpointSession>,
  options: PruneOptions = {}
) {
  return yield* Effect.tryPromise({
    try: () => pruneCheckpoints(repoPath, sessions, options),
    catch: toServiceError,
  });
});

/**
 * What the engine calls when a session is Archived: applies the policy to that
 * one session (other sessions' refs are left alone). With the default policy
 * this deletes nothing yet (the grace period starts now); it exists so a
 * policy with `compactAfterMs: 0` compacts at once, and so the call site is
 * already in place.
 */
export const onSessionArchived = Effect.fn("Checkpoints.onSessionArchived")(function* (
  repoPath: string,
  session: CheckpointSession,
  options: PruneOptions = {}
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const refs = (await listCheckpointRefs(repoPath)).filter(
        (r) => r.sessionId === session.sessionId
      );

      const unmergedBranches = await findUnmergedBranches(repoPath, [session]);

      const plan = planCheckpointPrune({
        refs,
        sessions: [session],
        now: options.now ?? Date.now(),
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        unmergedBranches,
      });

      if (!options.dryRun) await deleteRefs(repoPath, plan.delete);

      return plan;
    },
    catch: toServiceError,
  });
});

/** One repository and the sessions the engine knows in it, for the sweeper. */
export interface SweepTarget {
  readonly repoPath: string;
  readonly sessions: ReadonlyArray<CheckpointSession>;
}

/**
 * Prune every target once. A failing repository (moved, deleted, locked) is
 * logged and skipped; it never stops the others.
 */
export const sweepCheckpoints = Effect.fn("Checkpoints.sweep")(function* (
  targets: ReadonlyArray<SweepTarget>,
  options: PruneOptions = {}
) {
  const reports: Array<PruneReport> = [];

  for (const target of targets) {
    const report = yield* pruneCheckpointsEffect(target.repoPath, target.sessions, options).pipe(
      Effect.tapError((error) =>
        Effect.logWarning(`checkpoint prune of ${target.repoPath} failed: ${error.message}`)
      ),
      Effect.option
    );

    if (report._tag === "Some") reports.push(report.value);
  }

  return reports;
});

/**
 * The periodic sweeper. The engine forks it in its own scope and provides
 * `targets` (each Workspace path with its sessions); it runs once at start,
 * then every `interval` (6 hours by default), forever.
 */
export const runCheckpointSweeper = <E, R>(options: {
  readonly targets: Effect.Effect<ReadonlyArray<SweepTarget>, E, R>;
  readonly interval?: Duration.Input;
  readonly policy?: CheckpointPolicy;
}): Effect.Effect<never, never, R> =>
  Effect.gen(function* () {
    const targets = yield* options.targets;

    const reports = yield* sweepCheckpoints(
      targets,
      options.policy === undefined ? {} : { policy: options.policy }
    );

    const deleted = reports.reduce((n, r) => n + r.deleted.length, 0);

    if (deleted > 0) yield* Effect.logInfo(`pruned ${deleted} checkpoint refs`);
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("checkpoint sweep failed", cause)),
    Effect.repeat(Schedule.spaced(options.interval ?? Duration.hours(6))),
    Effect.andThen(Effect.never)
  );
