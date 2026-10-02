import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ConstellationTransferRpcs, type Constellation, type AttemptId } from "@polaris/protocol";
import { Context, Effect, Stream } from "effect";
import { offerBundle, takeBundle } from "../../git/constellationBundleStreams.ts";
import { paths } from "../../paths.ts";
import { EventStore } from "../../store/EventStore.ts";
import { constellationRef, fetchOrigin, pushOrigin } from "../../git/constellationBundles.ts";
import { gitText, resolveCommit } from "../../git/git.ts";
import { ConstellationCaller } from "../rpc.ts";
import { ConstellationWorktrees, gitOperation, transferError } from "../worktrees.ts";
import { ConstellationOwner } from "../runtime.ts";
import { TransferStorage } from "./storage.ts";
import { ConstellationOutbox, assignmentAttempt } from "./outbox.ts";
import { ConstellationBranchStatus } from "./branches.ts";
import { RemoteDeliveries } from "./delivery.ts";
import { RemotePlacements } from "./placements.ts";
import { RemoteAssignments, RemoteWorkers } from "./assignments.ts";

export class ConstellationTransferRoot extends Context.Reference<string>(
  "polaris/constellation/TransferRoot",
  { defaultValue: () => paths().root }
) {}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const publishedBranch = (graph: Constellation, attemptId: AttemptId | null, head: string) =>
  `${graph.settings.branchPrefix ?? "polaris"}/${hash(graph.id)}/${attemptId === null ? `base-${head}` : hash(attemptId)}`;

const publish = (
  graph: Constellation,
  repoPath: string,
  attemptId: AttemptId | null,
  head: string
) =>
  gitOperation(async () => {
    const branch = publishedBranch(graph, attemptId, head);
    const ref = `refs/heads/${branch}`;
    const previous = await resolveCommit(repoPath, ref);

    if (previous !== null && previous !== head)
      throw new Error("The published transfer branch already names another head");

    if (previous === null) await gitText(repoPath, ["update-ref", ref, head, ""]);
    const origin = await gitText(repoPath, ["remote", "get-url", "origin"]);
    await pushOrigin(repoPath, branch, head, graph.settings.branchPrefix ?? "polaris");

    return { head, ref, blobId: null, branch, origin, transfer: "origin" as const };
  });

const bundle = (repoPath: string, head: string, branch: string) =>
  offerBundle(repoPath, head).pipe(
    Effect.map((exported) => ({ ...exported, branch, origin: null, transfer: "bundle" as const }))
  );

const allowUser = (annotations: Context.Context<never>) => {
  const binding = Context.getOrUndefined(annotations, ConstellationCaller);

  return binding === undefined || binding.kind === "user"
    ? Effect.void
    : Effect.fail(transferError("E-AUTHORITY", "Transfers require the authenticated Desktop App"));
};

/** Mounted by L beside the graph RPCs; blobs always come from the request's existing connection. */
export const ConstellationTransferHandlers = ConstellationTransferRpcs.toLayer(
  Effect.gen(function* () {
    const root = yield* ConstellationTransferRoot;
    const store = yield* EventStore;
    const storage = yield* TransferStorage;
    const worktrees = yield* ConstellationWorktrees;
    const outbox = yield* ConstellationOutbox;
    const branches = yield* ConstellationBranchStatus;
    const deliveries = yield* RemoteDeliveries;
    const placements = yield* RemotePlacements;
    const assignments = yield* RemoteAssignments;
    const workers = yield* RemoteWorkers;
    const hostId = yield* ConstellationOwner;

    const owner = Effect.fnUntraced(function* (id: Constellation["id"]) {
      const model = yield* store.model;
      const graph = model.constellations.get(id)?.graph;

      const repoPath =
        graph === undefined ? undefined : model.sessions.get(graph.leadSessionId)?.session.cwd;

      if (graph === undefined || graph.hostId !== hostId || repoPath === undefined)
        return yield* transferError("E-OWNER", "The owning Lead checkout is unavailable", true);

      return { graph, repoPath };
    });

    const claimed = Effect.fnUntraced(function* (
      id: Constellation["id"],
      attemptId: AttemptId,
      head: string
    ) {
      const owned = yield* owner(id);
      const attempt = owned.graph.attempts.find((a) => a.id === attemptId);

      if (attempt?.claim?.head !== head)
        return yield* transferError(
          "E-CLAIM-HEAD",
          "The transfer does not match the committed Claim"
        );

      return owned;
    });

    const assignment = Effect.fnUntraced(function* (id: Constellation["id"], attemptId: AttemptId) {
      const found = (yield* storage.assignments).find(
        (a) => a.graph.id === id && a.attemptId === attemptId
      );

      if (found === undefined)
        return yield* transferError("E-ASSIGNMENT", "The worker assignment is unavailable", true);

      return found;
    });

    const use = <A, E, R>(annotations: Context.Context<never>, effect: Effect.Effect<A, E, R>) =>
      Effect.andThen(allowUser(annotations), effect);

    return {
      "constellation.delivery.watch": (_, { client }) =>
        Stream.unwrap(use(client.annotations, Effect.succeed(deliveries.watch))),
      "constellation.delivery.apply": ({ packet }, { client }) =>
        use(client.annotations, deliveries.apply(packet)),
      "constellation.delivery.ack": ({ receipt }, { client }) =>
        use(client.annotations, deliveries.ack(receipt)),
      "constellation.worktree.prepare": ({ request }, { client }) =>
        use(client.annotations, worktrees.prepare(request)),
      "constellation.bundle.export": ({ repoPath, head }, { client }) =>
        use(client.annotations, bundle(repoPath, head, "")),
      "constellation.bundle.import": (p, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            if (p.attemptId === null)
              return yield* transferError("E-ROUTE", "Use base.import for outward transfers");
            const { repoPath } = yield* claimed(p.constellationId, p.attemptId, p.head);

            const result = yield* takeBundle({
              ...p,
              repoPath,
              targetRef: constellationRef(p.constellationId, p.attemptId),
            });

            yield* branches.changed(p.constellationId, p.attemptId);

            return result;
          })
        ),
      "constellation.assignment.set": ({ assignment: value }, { client }) =>
        use(client.annotations, assignments.set(value)),
      "constellation.assignment.list": (_, { client }) =>
        use(client.annotations, storage.assignments),
      "constellation.outbox.watch": (_, { client }) =>
        Stream.unwrap(use(client.annotations, Effect.succeed(outbox.watch))),
      "constellation.outbox.apply": ({ packet }, { client }) =>
        use(client.annotations, outbox.apply(packet)),
      "constellation.outbox.ack": ({ receipt }, { client }) =>
        use(client.annotations, storage.ack(receipt)),
      "constellation.claim.export": (p, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            const a = yield* assignment(p.constellationId, p.attemptId);
            const attempt = assignmentAttempt(a);

            const pin = yield* gitOperation(() =>
              resolveCommit(attempt.worktree, constellationRef(a.graph.id, attempt.id))
            );

            if (pin !== p.head)
              return yield* transferError(
                "E-CLAIM-HEAD",
                "The transfer does not match the durable worker Claim"
              );

            return yield* a.graph.settings.transfer === "origin"
              ? publish(a.graph, attempt.worktree, attempt.id, p.head)
              : bundle(attempt.worktree, p.head, attempt.branch);
          })
        ),
      "constellation.origin.import": (p, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            const { graph, repoPath } = yield* claimed(p.constellationId, p.attemptId, p.head);

            if (
              graph.settings.transfer !== "origin" ||
              p.branch !== publishedBranch(graph, p.attemptId, p.head)
            )
              return yield* transferError(
                "E-ORIGIN",
                "Origin transfer was not selected for this Constellation"
              );

            const result = yield* gitOperation(() =>
              fetchOrigin(repoPath, p.branch, p.head, constellationRef(graph.id, p.attemptId))
            );

            yield* branches.changed(graph.id, p.attemptId);

            return result;
          })
        ),
      "constellation.base.export": (p, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            const { graph, repoPath } = yield* owner(p.constellationId);

            const head = yield* gitOperation(() => resolveCommit(repoPath, p.head));

            if (head === null)
              return yield* transferError("E-HEAD", "The base commit is unavailable");

            return yield* graph.settings.transfer === "origin"
              ? publish(graph, repoPath, null, head)
              : bundle(repoPath, head, publishedBranch(graph, null, head));
          })
        ),
      "constellation.base.import": (p, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            if (p.graph.hostId === hostId)
              return yield* transferError(
                "E-ROUTE",
                "An outward base requires a remote worker Host"
              );

            if (p.graph.settings.transfer === "origin") {
              if (p.origin === null)
                return yield* transferError("E-ORIGIN", "The base origin is missing");
              const origin = p.origin;
              yield* gitOperation(async () => {
                const existing = await gitText(p.repoPath, ["remote"]);

                if (!existing.split("\n").includes("origin"))
                  await gitText(p.repoPath, ["remote", "add", "origin", origin]);
                else if ((await gitText(p.repoPath, ["remote", "get-url", "origin"])) !== origin)
                  throw new Error("The worker repository has a different origin");
              });

              if (p.branch !== publishedBranch(p.graph, null, p.head))
                return yield* transferError("E-ORIGIN", "The base transfer branch does not match");

              return yield* gitOperation(() =>
                fetchOrigin(p.repoPath, p.branch, p.head, constellationRef(p.graph.id, null))
              );
            }

            if (p.blobId === null)
              return yield* transferError("E-BLOB", "The base bundle is missing");

            return yield* takeBundle({
              ...p,
              blobId: p.blobId,
              targetRef: constellationRef(p.graph.id, null),
            });
          })
        ),
      "constellation.placements.watch": (_, { client }) =>
        Stream.unwrap(use(client.annotations, Effect.succeed(placements.watch))),
      "constellation.placement.resolve": ({ id, response }, { client }) =>
        use(client.annotations, placements.resolve(id, response)),
      "constellation.repository.prepare": ({ request }, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            if (request.worker.hostId !== hostId || request.graph.hostId === hostId)
              return yield* transferError(
                "E-ROUTE",
                "The placement does not target this worker Host"
              );
            const supplied = request.worker.worktree;

            if (supplied !== null) return { repoPath: supplied };

            const repoPath = join(
              root,
              "constellation",
              "repos",
              hash(request.graph.hostId),
              hash(request.graph.workspaceId)
            );

            yield* gitOperation(async () => {
              await mkdir(repoPath, { recursive: true });
              await gitText(repoPath, ["init", "--initial-branch=main"]);
            });

            return { repoPath };
          })
        ),
      "constellation.worker.prepare": ({ request, prepared }, { client }) =>
        use(
          client.annotations,
          Effect.gen(function* () {
            if (request.worker.hostId !== hostId)
              return yield* transferError("E-ROUTE", "The placement targets another Host");

            return yield* workers.prepare(request, prepared);
          })
        ),
    };
  })
);
