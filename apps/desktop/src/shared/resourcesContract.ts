/**
 * Host resources and the worker cap over IPC (Settings → Hosts; C1-R's `ResourceRpcs`): each
 * forwards the Daemon RPC of the same name, with its payload unchanged.
 */
import {
  DeclareHostResource,
  GetHostResources,
  ReleaseHostResource,
  RemoveHostResource,
  SetHostWorkerCap,
} from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

const onHost = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ hostKey: HostKey, ...fields });

export const ResourceRequestInputs = {
  "host.resources.get": onHost(GetHostResources.payloadSchema.fields),
  "host.resources.declare": onHost(DeclareHostResource.payloadSchema.fields),
  "host.resources.remove": onHost(RemoveHostResource.payloadSchema.fields),
  "host.resources.release": onHost(ReleaseHostResource.payloadSchema.fields),
  "host.workers.setCap": onHost(SetHostWorkerCap.payloadSchema.fields),
} as const;

export type ResourceMethod = keyof typeof ResourceRequestInputs;
