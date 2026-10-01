import type { ResourceLease } from "@polaris/protocol";
import { firstWaiter, holders, type ResourcesModel } from "./model.ts";

/** Recheck at the EventStore commit boundary, including concurrent Lead plans. */
export const canGrantResource = (model: ResourcesModel, lease: ResourceLease): boolean => {
  const resource = model.resources.get(lease.resource);

  return (
    resource !== undefined &&
    resource.hostId === lease.hostId &&
    holders(model, lease.resource).length < resource.capacity &&
    firstWaiter(model, lease.resource)?.requestId === lease.id
  );
};
