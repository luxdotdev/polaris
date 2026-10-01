import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { HostResource, ResourceLease } from "./constellation/domain.ts";
import { CommandId, SessionId } from "./ids.ts";

const positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export class ResourceError extends Schema.TaggedError<ResourceError>()("ResourceError", {
  message: Schema.String,
}) {}

export class HostResourcesSnapshot extends Schema.Class<HostResourcesSnapshot>(
  "HostResourcesSnapshot"
)({
  resources: Schema.Array(HostResource),
  resourceLeases: Schema.Array(ResourceLease),
  waiting: Schema.Array(Schema.Struct({ resource: Schema.String, requestId: Schema.String })),
  overdueLeaseIds: Schema.Array(Schema.String),
  workerCap: Schema.Struct({
    cap: positive,
    default: positive,
    working: Schema.Int,
    waiting: Schema.Int,
  }),
}) {}

const mutation = { success: HostResourcesSnapshot, error: ResourceError };

export const GetHostResources = Rpc.make("host.resources.get", {
  ...mutation,
  payload: {},
});

export const DeclareHostResource = Rpc.make("host.resources.declare", {
  ...mutation,
  payload: {
    commandId: CommandId,
    name: Schema.NonEmptyString,
    capacity: Schema.optionalKey(positive),
    holdLimitMs: Schema.optionalKey(positive),
  },
});

export const RemoveHostResource = Rpc.make("host.resources.remove", {
  ...mutation,
  payload: { commandId: CommandId, name: Schema.NonEmptyString },
});

export const ReleaseHostResource = Rpc.make("host.resources.release", {
  ...mutation,
  payload: { commandId: CommandId, leaseId: Schema.NonEmptyString },
});

export const SetHostWorkerCap = Rpc.make("host.workers.setCap", {
  ...mutation,
  payload: { commandId: CommandId, cap: Schema.NullOr(positive) },
});

export const AcquireHostResource = Rpc.make("host.resources.acquire", {
  success: ResourceLease,
  error: ResourceError,
  payload: {
    requestId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    processId: positive,
    processIdentity: Schema.NonEmptyString,
    command: Schema.Array(Schema.String),
    sessionId: Schema.NullOr(SessionId),
  },
});

export class ResourceRpcs extends RpcGroup.make(
  GetHostResources,
  DeclareHostResource,
  RemoveHostResource,
  ReleaseHostResource,
  SetHostWorkerCap,
  AcquireHostResource
) {}
