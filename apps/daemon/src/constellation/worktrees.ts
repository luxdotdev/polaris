import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Attempt,
  type Constellation,
  type SessionId,
  ConstellationTransferError,
  PreparedWorktree,
  WorktreeRequest,
} from "@polaris/protocol";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { gitText, resolveCommit } from "../git/git.ts";
import { gitStatus } from "../git/status.ts";
import { listWorktrees, samePath } from "../git/WorktreeTracker.ts";
import { constellationRef, mergedInto } from "../git/constellationBundles.ts";
import { TransferStorage, decodePlacement, encodePlacement } from "./transfers/storage.ts";

const requestJson = Schema.encodeSync(Schema.fromJsonString(WorktreeRequest));

export const transferError = (code: string, message: string, retryable = false) =>
  new ConstellationTransferError({ code, message, retryable });

export const gitOperation = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) =>
      transferError("E-GIT", cause instanceof Error ? cause.message : String(cause), true),
  });

const component = (name: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name))
    throw new Error("Constellation and Task IDs must be single path components");

  return name;
};

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";

const calculate = async (request: WorktreeRequest): Promise<PreparedWorktree> => {
  const repoPath = resolve(request.repoPath);
  const leadPath = request.leadPath === null ? repoPath : resolve(request.leadPath);

  const common = await gitText(repoPath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);

  const leadCommon = await gitText(leadPath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);

  if (!samePath(common, leadCommon))
    throw new Error("The Lead checkout belongs to a different repository");
  const base = await resolveCommit(leadPath, request.base ?? "HEAD");

  if (base === null) throw new Error("The requested base is not a commit in the repository");

  const worktree =
    request.worktree === null
      ? `${repoPath}.worktrees/${component(request.constellationId)}/${component(request.task.id)}`
      : resolve(repoPath, request.worktree);

  const registered = (await listWorktrees(repoPath)).find((w) => samePath(w.path, worktree));

  const branch =
    request.branch ??
    registered?.branch ??
    `${request.branchPrefix.replace(/\/$/, "")}/${component(request.constellationId)}/${component(request.task.id)}-${slug(request.task.title)}`;

  await gitText(repoPath, ["check-ref-format", "--branch", branch]);

  if (registered !== undefined && registered.branch !== branch)
    throw new Error("The existing worktree uses a different branch");

  if (registered === undefined && existsSync(worktree))
    throw new Error("The worktree path already holds an unregistered directory");

  return PreparedWorktree.make({
    repoPath,
    worktree,
    branch,
    base,
    managed: registered === undefined && request.worktree === null,
    managedBranch:
      request.branch === null && (await resolveCommit(repoPath, `refs/heads/${branch}`)) === null,
  });
};

const ensure = async (prepared: PreparedWorktree) => {
  const registered = (await listWorktrees(prepared.repoPath)).find((w) =>
    samePath(w.path, prepared.worktree)
  );

  if (registered !== undefined) {
    if (registered.branch !== prepared.branch || !existsSync(prepared.worktree))
      throw new Error("The prepared worktree changed or was deleted");

    return;
  }

  const existing = await resolveCommit(prepared.repoPath, `refs/heads/${prepared.branch}`);
  await gitText(prepared.repoPath, [
    "-c",
    "core.hooksPath=/dev/null",
    "worktree",
    "add",
    ...(existing === null
      ? ["-b", prepared.branch, prepared.worktree, prepared.base]
      : [prepared.worktree, prepared.branch]),
  ]);
};

export interface CleanupResult {
  readonly worktree: string;
  readonly removed: boolean;
  readonly reason: string | null;
}

export class ConstellationWorktrees extends Context.Service<
  ConstellationWorktrees,
  {
    readonly prepare: (
      request: WorktreeRequest
    ) => Effect.Effect<PreparedWorktree, ConstellationTransferError>;
    readonly gate: (
      repoPath: string,
      leadPath: string
    ) => Effect.Effect<PreparedWorktree, ConstellationTransferError>;
    readonly probeClaim: (
      attempt: Attempt
    ) => Effect.Effect<
      { dirtyPaths: ReadonlyArray<string>; branch: string; head: string },
      ConstellationTransferError
    >;
    readonly verifyMerged: (
      graph: Constellation,
      attempt: Attempt,
      leadPath: string,
      mergedHead: string
    ) => Effect.Effect<void, ConstellationTransferError>;
    readonly cleanup: (
      graph: Constellation,
      leadPath: string,
      candidates: ReadonlyArray<{ attempt: Attempt; prepared: PreparedWorktree }>,
      busySessions: ReadonlySet<SessionId>,
      mergedRef?: string
    ) => Effect.Effect<ReadonlyArray<CleanupResult>, ConstellationTransferError>;
  }
>()("polaris/constellation/Worktrees") {
  static readonly layer = Layer.effect(
    ConstellationWorktrees,
    Effect.gen(function* () {
      const storage = yield* TransferStorage;
      const serial = yield* Semaphore.make(1);

      return ConstellationWorktrees.of({
        prepare: (request) =>
          serial.withPermits(1)(
            Effect.gen(function* () {
              const encoded = requestJson(request);
              const cached = yield* storage.get("placements", request.key);

              if (cached !== null) {
                const previous = decodePlacement(cached);

                if (previous.request !== encoded)
                  return yield* transferError(
                    "E-IDEMPOTENCY",
                    "The placement ID already names another request"
                  );

                if (!previous.removed) yield* gitOperation(() => ensure(previous.prepared));

                return previous.prepared;
              }

              const calculated = yield* gitOperation(() => calculate(request));

              const previous = (yield* storage.placements).find(
                (p) =>
                  samePath(p.prepared.worktree, calculated.worktree) &&
                  p.prepared.branch === calculated.branch
              );

              const prepared =
                previous === undefined
                  ? calculated
                  : PreparedWorktree.make({
                      repoPath: calculated.repoPath,
                      worktree: calculated.worktree,
                      branch: calculated.branch,
                      base: calculated.base,
                      managed: previous.prepared.managed,
                      managedBranch: previous.prepared.managedBranch,
                    });

              yield* storage.put(
                "placements",
                request.key,
                encodePlacement({ request: encoded, prepared, removed: false })
              );
              yield* gitOperation(() => ensure(prepared));

              return prepared;
            })
          ),
        gate: (repoPath, leadPath) =>
          gitOperation(async () => {
            const status = await gitStatus(leadPath);

            if (status.branch === null || status.head === null)
              throw new Error("The Gate requires the Lead's current branch");

            if (
              !samePath(
                await gitText(repoPath, [
                  "rev-parse",
                  "--path-format=absolute",
                  "--git-common-dir",
                ]),
                await gitText(leadPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
              )
            )
              throw new Error("The Lead checkout belongs to another repository");

            return PreparedWorktree.make({
              repoPath,
              worktree: leadPath,
              branch: status.branch,
              base: status.head,
              managed: false,
              managedBranch: false,
            });
          }),
        probeClaim: (attempt) =>
          gitOperation(async () => {
            const status = await gitStatus(attempt.worktree);

            const branchHead = await resolveCommit(
              attempt.worktree,
              `refs/heads/${attempt.branch}`
            );

            if (
              status.head === null ||
              branchHead !== status.head ||
              status.branch !== attempt.branch
            )
              throw new Error("The worker HEAD is not on its assigned branch");

            return {
              dirtyPaths: status.entries.map((e) => e.path),
              branch: status.branch,
              head: status.head,
            };
          }),
        verifyMerged: (graph, attempt, leadPath, mergedHead) =>
          gitOperation(async () => {
            if (attempt.claim === null || mergedHead !== attempt.claim.head)
              throw new Error("The merged head does not match the claimed head");

            if ((await resolveCommit(leadPath, mergedHead)) !== mergedHead)
              throw new Error("The claimed commit has not been fetched locally");

            if (
              attempt.hostId !== graph.hostId &&
              (await resolveCommit(leadPath, constellationRef(graph.id, attempt.id))) !== mergedHead
            )
              throw new Error("The claimed branch has not been fetched for this Attempt");

            if (!(await mergedInto(leadPath, mergedHead, "HEAD")))
              throw new Error("The claimed head has not been merged into the Lead's branch");
          }),
        cleanup: (graph, leadPath, candidates, busySessions, mergedRef = "HEAD") =>
          serial.withPermits(1)(
            Effect.gen(function* () {
              const removed = yield* gitOperation(async () => {
                const results: Array<CleanupResult> = [];

                for (const { attempt, prepared } of candidates) {
                  const blocked = await cleanupBlock(
                    graph,
                    attempt,
                    prepared,
                    leadPath,
                    busySessions,
                    mergedRef
                  );

                  if (blocked !== null) {
                    results.push({ worktree: prepared.worktree, removed: false, reason: blocked });
                    continue;
                  }

                  await gitText(prepared.repoPath, [
                    "-c",
                    "core.hooksPath=/dev/null",
                    "worktree",
                    "remove",
                    prepared.worktree,
                  ]);
                  results.push({ worktree: prepared.worktree, removed: true, reason: null });
                }

                return results;
              });

              for (const result of removed) {
                if (!result.removed) continue;

                for (const placement of yield* storage.placements) {
                  if (!samePath(placement.prepared.worktree, result.worktree)) continue;

                  const request = Schema.decodeUnknownSync(Schema.fromJsonString(WorktreeRequest))(
                    placement.request
                  );

                  yield* storage.put(
                    "placements",
                    request.key,
                    encodePlacement({ ...placement, removed: true })
                  );
                }
              }

              return removed;
            })
          ),
      });
    })
  );
}

const cleanupBlock = async (
  graph: Constellation,
  attempt: Attempt,
  prepared: PreparedWorktree,
  leadPath: string,
  busy: ReadonlySet<SessionId>,
  mergedRef: string
): Promise<string | null> => {
  if (!prepared.managed) return "The worktree was supplied by the user";

  if (
    graph.attempts.some(
      (a) =>
        samePath(a.worktree, prepared.worktree) &&
        (a.state === "working" || a.state === "blocked" || a.state === "review")
    )
  )
    return "The worktree carries active work";

  if (
    attempt.state === "working" ||
    attempt.state === "blocked" ||
    attempt.state === "review" ||
    busy.has(attempt.sessionId)
  )
    return "The worker still has active work";

  const mergingGate = graph.tasks.some(
    (t) =>
      t.kind === "gate" &&
      t.deps.includes(attempt.taskId) &&
      graph.attempts.findLast((a) => a.taskId === t.id)?.state === "accepted"
  );

  if (graph.state !== "archived" && !mergingGate) return "The merging Gate has not been accepted";

  if (!existsSync(prepared.worktree)) return "The worktree is already absent";

  const registered = (await listWorktrees(prepared.repoPath)).find((w) =>
    samePath(w.path, prepared.worktree)
  );

  if (registered === undefined || registered.isMain || registered.branch !== prepared.branch)
    return "The worktree registration changed";
  const status = await gitStatus(prepared.worktree);

  if (status.entries.length > 0) return "The worktree has uncommitted changes";

  if ((await resolveCommit(leadPath, mergedRef)) === null)
    return "The merged Lead head is unavailable";

  if (status.head === null || !(await mergedInto(leadPath, status.head, mergedRef)))
    return "The worktree has unmerged commits";

  return null;
};
