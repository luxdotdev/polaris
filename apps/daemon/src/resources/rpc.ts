import { ResourceRpcs } from "@polaris/protocol";
import { Effect } from "effect";
import { HostResources } from "./index.ts";

export const ResourceRpcsLive = ResourceRpcs.toLayer(
  Effect.gen(function* () {
    const resources = yield* HostResources;

    return {
      "host.resources.get": () => resources.get,
      "host.resources.declare": ({ commandId, name, capacity, holdLimitMs }) =>
        resources.declare(commandId, name, capacity ?? 1, holdLimitMs),
      "host.resources.remove": ({ commandId, name }) => resources.remove(commandId, name),
      "host.resources.release": ({ commandId, leaseId }) => resources.release(commandId, leaseId),
      "host.workers.setCap": ({ commandId, cap }) => resources.setWorkerCap(commandId, cap),
      "host.resources.acquire": (request) => resources.acquire(request),
    };
  })
);
