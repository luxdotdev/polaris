import { expect, test } from "bun:test";
import { Schema } from "effect";
import { HostId } from "./ids.ts";
import { DomainEvent } from "./events.ts";
import { ResourceEvent } from "./constellation/events.ts";
import { ResourceLease } from "./constellation/domain.ts";
import { DaemonRpcs } from "./rpc.ts";
import { DeclareHostResource, ResourceRpcs, SetHostWorkerCap } from "./resources.ts";

test("older resource events decode without the additive process fields", () => {
  const lease = Schema.decodeUnknownSync(Schema.fromJsonString(DomainEvent))(
    '{"_tag":"ResourceLeased","lease":{"id":"old","hostId":"host","resource":"bench","sessionId":null,"attemptId":null,"command":[],"processId":123,"acquiredAt":"2026-10-01T00:00:00.000Z"}}'
  );

  expect(lease._tag).toBe("ResourceLeased");

  const queued = Schema.decodeUnknownSync(Schema.fromJsonString(ResourceEvent))(
    '{"_tag":"ResourceLeaseQueued","hostId":"host","resource":"bench","requestId":"old","sessionId":null}'
  );

  expect(queued._tag).toBe("ResourceLeaseQueued");
});

test("process metadata, cancellation and removal round-trip through the persisted codec", () => {
  const codec = Schema.fromJsonString(Schema.toCodecJson(DomainEvent));

  for (const event of [
    DomainEvent.cases.ResourceLeaseQueued.make({
      hostId: HostId.make("host"),
      resource: "bench",
      requestId: "request",
      sessionId: null,
      processId: 123,
      processIdentity: "Thu Oct 1 00:00:00 2026",
      command: ["bun", "run", "bench"],
    }),
    DomainEvent.cases.ResourceLeased.make({
      lease: ResourceLease.make({
        id: "request",
        hostId: HostId.make("host"),
        resource: "bench",
        sessionId: null,
        attemptId: null,
        processId: 123,
        processIdentity: "Thu Oct 1 00:00:00 2026",
        command: ["bun", "run", "bench"],
        acquiredAt: "2026-10-01T00:00:00.000Z",
      }),
    }),
    DomainEvent.cases.ResourceLeaseCanceled.make({
      hostId: HostId.make("host"),
      resource: "bench",
      requestId: "request",
      reason: "process exited",
    }),
    DomainEvent.cases.ResourceRemoved.make({ hostId: HostId.make("host"), resource: "bench" }),
  ]) {
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(event))).toEqual(event);
  }
});

test("Settings RPCs are mounted and validate capacities and defaults", () => {
  for (const [tag, rpc] of ResourceRpcs.requests) expect(DaemonRpcs.requests.get(tag)).toBe(rpc);
  expect(() =>
    Schema.decodeUnknownSync(DeclareHostResource.payloadSchema)({
      commandId: "c",
      name: "bench",
      capacity: 0,
    })
  ).toThrow();
  expect(
    Schema.decodeUnknownSync(DeclareHostResource.payloadSchema)({
      commandId: "c",
      name: "bench",
    }).capacity
  ).toBeUndefined();
  expect(
    Schema.decodeUnknownSync(SetHostWorkerCap.payloadSchema)({ commandId: "c", cap: null }).cap
  ).toBeNull();
});
