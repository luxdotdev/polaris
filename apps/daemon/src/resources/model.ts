import {
  type DomainEvent,
  HostResource,
  type ResourceLease,
  ResourceEvent,
} from "@polaris/protocol";
import { Option, Schema } from "effect";

export const WORKERS_RESOURCE = "__workers";

export const DEFAULT_HOLD_LIMIT_MS = 30 * 60 * 1000;

export type LeaseWaiter = typeof ResourceEvent.cases.ResourceLeaseQueued.Type;

export interface ResourcesModel {
  readonly resources: Map<string, HostResource>;
  readonly leases: Map<string, ResourceLease>;
  readonly waiting: Map<string, LeaseWaiter>;
}

export const emptyResources = (): ResourcesModel => ({
  resources: new Map(),
  leases: new Map(),
  waiting: new Map(),
});

const resourceEvent = Schema.decodeUnknownOption(ResourceEvent);

/** Fold only Host resource events; unrelated events never change this projection. */
export const foldResources = (model: ResourcesModel, events: ReadonlyArray<DomainEvent>) => {
  for (const event of events) {
    const decoded = resourceEvent(event);

    if (Option.isNone(decoded)) continue;
    ResourceEvent.match<void>({
      ResourceDeclared: ({ resource }) => {
        model.resources.set(resource.name, resource);
      },
      ResourceRemoved: ({ resource }) => {
        model.resources.delete(resource);
      },
      ResourceLeaseQueued: (waiter) => {
        model.waiting.set(waiter.requestId, waiter);
      },
      ResourceLeaseCanceled: ({ requestId }) => {
        model.waiting.delete(requestId);
      },
      ResourceLeased: ({ lease }) => {
        model.waiting.delete(lease.id);
        model.leases.set(lease.id, lease);
      },
      ResourceReleased: ({ leaseId }) => {
        model.leases.delete(leaseId);
        model.waiting.delete(leaseId);
      },
    })(decoded.value);
  }

  return model;
};

export const holders = (model: ResourcesModel, name: string) =>
  [...model.leases.values()].filter((lease) => lease.resource === name);

export const firstWaiter = (model: ResourcesModel, name: string) =>
  [...model.waiting.values()].find((waiter) => waiter.resource === name);
