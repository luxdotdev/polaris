import {
  type Constellation,
  type ConstellationOutboxPacket,
  RemotePlacementResponse,
  RemoteWorkerAssignment,
  type RemotePlacementRequest,
  WorktreeRequest,
  ConstellationTransferError,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import type { LiveSession } from "../HostConnection.ts";

/** A receipt reaches the owner before the bundle; only the fully fetched Claim is acknowledged. */
export const relayOutboxPacket = Effect.fnUntraced(function* (
  worker: LiveSession,
  owner: LiveSession,
  packet: ConstellationOutboxPacket
) {
  const receipt = yield* owner.client["constellation.outbox.apply"]({ packet });

  if (
    Predicate.isTagged(receipt, "Applied") &&
    Predicate.isTagged(packet.entry.command, "WorkerClaim")
  ) {
    const command = packet.entry.command;

    const transfer = yield* worker.client["constellation.claim.export"]({
      constellationId: command.constellationId,
      attemptId: command.attemptId,
      head: command.claim.head,
    });

    if (transfer.transfer === "origin") {
      yield* owner.client["constellation.origin.import"]({
        constellationId: command.constellationId,
        attemptId: command.attemptId,
        head: command.claim.head,
        branch: transfer.branch,
      });
    } else {
      if (transfer.blobId === null)
        return yield* new ConstellationTransferError({
          code: "E-BLOB",
          message: "The worker did not provide its Claim bundle",
          retryable: true,
        });
      const blobId = yield* owner.blobs.offer(worker.blobs.takeStream(transfer.blobId));
      yield* owner.client["constellation.bundle.import"]({
        constellationId: command.constellationId,
        attemptId: command.attemptId,
        repoPath: "",
        head: transfer.head,
        ref: transfer.ref,
        blobId,
      });
    }
  }

  yield* worker.client["constellation.outbox.ack"]({ receipt });

  return receipt;
});

/** Reusable by remote Dispatch and linked send-back; neither side starts a Session here. */
export const prepareRemotePlacement = Effect.fnUntraced(function* (
  owner: LiveSession,
  worker: LiveSession,
  request: RemotePlacementRequest
) {
  const { repoPath } = yield* worker.client["constellation.repository.prepare"]({ request });

  const transfer = yield* owner.client["constellation.base.export"]({
    constellationId: request.graph.id,
    head: request.baseHead,
  });

  let blobId = null;

  if (transfer.transfer === "bundle") {
    if (transfer.blobId === null)
      return yield* new ConstellationTransferError({
        code: "E-BLOB",
        message: "The owner did not provide the base bundle",
        retryable: true,
      });
    blobId = yield* worker.blobs.offer(owner.blobs.takeStream(transfer.blobId));
  }

  yield* worker.client["constellation.base.import"]({
    graph: request.graph,
    repoPath,
    head: transfer.head,
    ref: transfer.ref,
    branch: transfer.branch,
    origin: transfer.origin,
    blobId,
  });

  const prepared = yield* worker.client["constellation.worktree.prepare"]({
    request: WorktreeRequest.make({
      key: request.id,
      constellationId: request.graph.id,
      task: request.task,
      repoPath,
      leadPath: null,
      branchPrefix: request.graph.settings.branchPrefix ?? "polaris",
      base: request.baseHead,
      worktree: request.worker.worktree,
      branch: request.worker.branch,
    }),
  });

  const attempt = yield* worker.client["constellation.worker.prepare"]({ request, prepared });
  yield* owner.client["constellation.placement.resolve"]({
    id: request.id,
    response: RemotePlacementResponse.cases.Prepared.make({ attempt }),
  });

  return attempt;
});

/** Owner projections mirror assignments on their worker Host; they are never graph commits there. */
export const mirrorRemoteAssignments = Effect.fnUntraced(function* (
  graph: Constellation,
  worker: LiveSession,
  owner?: LiveSession
) {
  if (
    owner !== undefined &&
    (graph.state === "archived" ||
      graph.tasks.some(
        (t) =>
          t.kind === "gate" &&
          graph.attempts.findLast((a) => a.taskId === t.id)?.state === "accepted"
      ))
  )
    yield* fetchCleanupHead(graph, owner, worker);

  for (const attempt of graph.attempts) {
    if (attempt.hostId !== worker.host.hostId) continue;
    yield* worker.client["constellation.assignment.set"]({
      assignment: RemoteWorkerAssignment.make({
        graph,
        attemptId: attempt.id,
        repoPath: attempt.worktree,
      }),
    });
  }
});

export const relayRemoteDelivery = Effect.fnUntraced(function* (
  owner: LiveSession,
  worker: LiveSession,
  packet: import("@polaris/protocol").RemoteDeliveryPacket
) {
  const receipt = yield* worker.client["constellation.delivery.apply"]({ packet });
  yield* owner.client["constellation.delivery.ack"]({ receipt });
});

const fetchCleanupHead = Effect.fnUntraced(function* (
  graph: Constellation,
  owner: LiveSession,
  worker: LiveSession
) {
  const assignments = yield* worker.client["constellation.assignment.list"]({});

  for (const repoPath of new Set(
    assignments.filter((a) => a.graph.id === graph.id).map((a) => a.repoPath)
  )) {
    const transfer = yield* owner.client["constellation.base.export"]({
      constellationId: graph.id,
      head: "HEAD",
    });

    const blobId =
      transfer.blobId === null
        ? null
        : yield* worker.blobs.offer(owner.blobs.takeStream(transfer.blobId));

    yield* worker.client["constellation.base.import"]({
      graph,
      repoPath,
      head: transfer.head,
      ref: transfer.ref,
      branch: transfer.branch,
      origin: transfer.origin,
      blobId,
    });
  }
});
