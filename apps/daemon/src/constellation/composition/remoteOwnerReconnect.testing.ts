import {
  Attempt,
  CommandId,
  DomainEvent,
  PlanOperation,
  ReviewAction,
  RemoteDeliveryPacket,
  WorkerPlacement,
} from "@polaris/protocol";
import { Context, Effect, Layer, Stream, Struct } from "effect";
import {
  A,
  B,
  C,
  CID,
  LEAD,
  WS,
  ctx,
  draft,
  report,
  task,
} from "../../engine/constellation.testing.ts";
import { decideConstellation } from "../../engine/constellation.ts";
import type { ConstellationContext } from "../../engine/constellation.inputs.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationOwner, ConstellationRuntime } from "../runtime.ts";
import {
  ConstellationDelivery,
  ConstellationRemoteDelivery,
  ConstellationSessionEffects,
} from "../delivery/index.ts";
import { startConstellationDelivery } from "../delivery/startup.ts";
import { send, session, STANDALONE, WORKER } from "../delivery/testing.ts";
import type { fakeHost } from "../transfers/fakeHost.testing.ts";

export type TestHost = Effect.Success<ReturnType<typeof fakeHost>>;

export const command = Effect.fnUntraced(function* (
  host: TestHost,
  command: import("@polaris/protocol").ConstellationCommand,
  patch: Partial<ConstellationContext> = {}
) {
  yield* host.store.commit({
    commandId: CommandId.make(crypto.randomUUID()),
    decide: (model) => {
      const result = decideConstellation(
        model.constellations.get(CID),
        command,
        ctx({ hostId: host.host.hostId, commanded: true, ...patch })
      );

      return result.rejection === null
        ? Effect.succeed(result.events)
        : Effect.fail(result.rejection);
    },
  });
});

export const blockedPair = Effect.fnUntraced(function* (owner: TestHost, worker: TestHost) {
  yield* owner.store.commit({
    commandId: CommandId.make("lead"),
    decide: () =>
      Effect.succeed([DomainEvent.cases.SessionCreated.make({ session: session(LEAD) })]),
  });
  yield* worker.store.commit({
    commandId: CommandId.make("worker"),
    decide: () =>
      Effect.succeed([DomainEvent.cases.SessionCreated.make({ session: session(WORKER) })]),
  });
  yield* send(WORKER).pipe(Effect.provideService(EventStore, worker.store));
  yield* command(
    owner,
    C.Plan.make({
      constellationId: CID,
      start: { name: "Reconnect", workspaceId: WS, leadSessionId: LEAD },
      operations: [A, B].map((id) => PlanOperation.cases.Add.make({ task: task(id) })),
    })
  );
  const attempt = Attempt.make(Struct.assign(draft(), { hostId: worker.host.hostId }));
  yield* command(
    owner,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [{ taskId: A, worker: WorkerPlacement.cases.Existing.make({ sessionId: WORKER }) }],
    }),
    { attempts: [attempt] }
  );
  yield* command(
    owner,
    C.WorkerBlock.make({
      constellationId: CID,
      attemptId: attempt.id,
      on: [B],
      reason: "Wait for feed",
    }),
    { binding: { kind: "session", sessionId: WORKER } }
  );

  return attempt;
});

export const acceptFeed = Effect.fnUntraced(function* (owner: TestHost) {
  const feed = Attempt.make(
    Struct.assign(draft(B, "feed", STANDALONE), { hostId: owner.host.hostId })
  );

  yield* command(
    owner,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [
        { taskId: B, worker: WorkerPlacement.cases.Existing.make({ sessionId: STANDALONE }) },
      ],
    }),
    { attempts: [feed] }
  );
  const claim = report(feed.branch, "feed-head");
  yield* command(owner, C.WorkerClaim.make({ constellationId: CID, attemptId: feed.id, claim }), {
    binding: { kind: "session", sessionId: STANDALONE },
    claimProbe: { branch: feed.branch, head: claim.head, dirtyPaths: [] },
  });
  yield* command(
    owner,
    C.Review.make({
      constellationId: CID,
      attemptId: feed.id,
      revision: 1,
      action: ReviewAction.cases.Accept.make({ mergedHead: claim.head, receipts: [] }),
    })
  );
});

export const startOwnerDelivery = Effect.fnUntraced(function* (owner: TestHost) {
  const service = yield* Layer.build(
    ConstellationDelivery.layer.pipe(
      Layer.provide(Layer.succeed(EventStore)(owner.store)),
      Layer.provide(Layer.succeed(ConstellationOwner)(owner.host.hostId)),
      Layer.provide(
        Layer.succeed(ConstellationRemoteDelivery)({
          send: (packet) =>
            owner.deliveries.send(RemoteDeliveryPacket.make(packet)).pipe(Effect.orDie),
        })
      ),
      Layer.provide(
        Layer.succeed(ConstellationSessionEffects)({
          canSteer: () => Effect.succeed(true),
          runTurn: () => Effect.void,
          steer: () => Effect.void,
          interrupt: () => Effect.void,
          retire: () => Effect.void,
        })
      )
    )
  );

  const delivery = Context.get(service, ConstellationDelivery);
  yield* startConstellationDelivery({
    runtime: Context.get(Context.empty(), ConstellationRuntime),
    acknowledged: owner.deliveries.acknowledged.pipe(Stream.orDie),
  }).pipe(Effect.provideService(ConstellationDelivery, delivery));

  return delivery;
});
