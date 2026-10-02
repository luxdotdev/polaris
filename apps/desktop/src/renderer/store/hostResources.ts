/**
 * A Host's resources as its feed carries them (C1-R): declared resources, held leases and
 * queued requests, folded from `Resource*` events over the Snapshot's arrays. Settings → Hosts
 * reads it to know when to ask again; the cap and overdue holds come from `host.resources.get`.
 */
import type { HostResource, ResourceEvent, ResourceLease } from "@polaris/protocol";
import { Match } from "effect";

export interface HostResources {
  readonly resources: ReadonlyMap<string, HostResource>;
  readonly leases: ReadonlyMap<string, ResourceLease>;
  /** Queued request id → its resource. */
  readonly queued: ReadonlyMap<string, string>;
}

export const resourcesFromSnapshot = (
  resources: ReadonlyArray<HostResource> = [],
  leases: ReadonlyArray<ResourceLease> = []
): HostResources => ({
  resources: new Map(resources.map((r) => [r.name, r])),
  leases: new Map(leases.map((l) => [l.id, l])),
  queued: new Map(),
});

const without = <V>(map: ReadonlyMap<string, V>, key: string) => {
  const next = new Map(map);

  next.delete(key);

  return next;
};

const withKey = <V>(map: ReadonlyMap<string, V>, key: string, value: V) =>
  new Map(map).set(key, value);

export const applyResourceEvent = (state: HostResources, event: ResourceEvent): HostResources =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      ResourceDeclared: ({ resource }) => ({
        ...state,
        resources: withKey(state.resources, resource.name, resource),
      }),
      ResourceRemoved: ({ resource }) => ({
        ...state,
        resources: without(state.resources, resource),
      }),
      ResourceLeaseQueued: ({ requestId, resource }) => ({
        ...state,
        queued: withKey(state.queued, requestId, resource),
      }),
      ResourceLeaseCanceled: ({ requestId }) => ({
        ...state,
        queued: without(state.queued, requestId),
      }),
      // A lease's id is its queued request id.
      ResourceLeased: ({ lease }) => ({
        ...state,
        leases: withKey(state.leases, lease.id, lease),
        queued: without(state.queued, lease.id),
      }),
      ResourceReleased: ({ leaseId }) => ({ ...state, leases: without(state.leases, leaseId) }),
    })
  );
