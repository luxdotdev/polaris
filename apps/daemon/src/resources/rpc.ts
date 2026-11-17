import { ResourceError, ResourceRpcs } from "@polaris/protocol";
import { Effect } from "effect";
import type { Rpc } from "effect/rpc";
import { lacksUserAccess } from "../userAccess/index.ts";
import { HostResources } from "./service.ts";

export const ResourceRpcsLive = ResourceRpcs.toLayer(
  Effect.gen(function* () {
    const resources = yield* HostResources;
    /** The lease requests each connection made itself, new on this Host when it asked. */
    const asked = new WeakMap<Rpc.ServerClient, Set<string>>();

    const known = (requestId: string) =>
      Effect.map(
        resources.get,
        (snapshot) =>
          snapshot.resourceLeases.some((lease) => lease.id === requestId) ||
          snapshot.waiting.some((waiter) => waiter.requestId === requestId)
      );

    return {
      "host.resources.get": () => resources.get,
      "host.resources.declare": ({ commandId, name, capacity, holdLimitMs }) =>
        resources.declare(commandId, name, capacity ?? 1, holdLimitMs),
      "host.resources.remove": ({ commandId, name }) => resources.remove(commandId, name),
      // Without user access, only a lease this connection asked for (ADR 0114).
      "host.resources.release": ({ commandId, leaseId }, { client }) =>
        lacksUserAccess(client.annotations) && asked.get(client)?.has(leaseId) !== true
          ? Effect.fail(
              new ResourceError({ message: "Only the user releases another process's lease" })
            )
          : resources.release(commandId, leaseId),
      "host.workers.setCap": ({ commandId, cap }) => resources.setWorkerCap(commandId, cap),
      "host.resources.acquire": (request, { client }) =>
        Effect.gen(function* () {
          // A request that already exists stays its first asker's: a reconnect can't claim it.
          if (!(yield* known(request.requestId)))
            asked.set(client, (asked.get(client) ?? new Set()).add(request.requestId));

          return yield* resources.acquire(request);
        }),
    };
  })
);
