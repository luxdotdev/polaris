import { describe, expect, test } from "bun:test";
import { HostId, HostResource, ResourceEvent, ResourceLease } from "@polaris/protocol";
import { applyResourceEvent, resourcesFromSnapshot } from "./hostResources.ts";

const hostId = HostId.make("h");

const lease = new ResourceLease({
  id: "req-1",
  hostId,
  resource: "bench",
  sessionId: null,
  attemptId: null,
  command: ["bun", "run", "bench"],
  processId: 42,
  acquiredAt: "2026-10-01T10:00:00.000Z",
});

const events = [
  ResourceEvent.cases.ResourceDeclared.make({
    resource: new HostResource({ hostId, name: "bench", capacity: 1 }),
  }),
  ResourceEvent.cases.ResourceLeaseQueued.make({ hostId, resource: "bench", requestId: "req-1" }),
  ResourceEvent.cases.ResourceLeaseQueued.make({ hostId, resource: "bench", requestId: "req-2" }),
  ResourceEvent.cases.ResourceLeased.make({ lease }),
  ResourceEvent.cases.ResourceLeaseCanceled.make({
    hostId,
    resource: "bench",
    requestId: "req-2",
    reason: "the command exited while queued",
  }),
];

describe("applyResourceEvent", () => {
  const held = events.reduce(applyResourceEvent, resourcesFromSnapshot());

  test("a lease takes its queued request; a canceled request leaves the queue", () => {
    expect([...held.resources.keys()]).toEqual(["bench"]);
    expect([...held.leases.keys()]).toEqual(["req-1"]);
    expect(held.queued.size).toBe(0);
  });

  test("release and removal", () => {
    const after = [
      ResourceEvent.cases.ResourceReleased.make({
        hostId,
        leaseId: "req-1",
        resource: "bench",
        reason: "exited",
      }),
      ResourceEvent.cases.ResourceRemoved.make({ hostId, resource: "bench" }),
    ].reduce(applyResourceEvent, held);

    expect(after.leases.size).toBe(0);
    expect(after.resources.size).toBe(0);
  });
});

test("a Snapshot's arrays seed it", () => {
  const seeded = resourcesFromSnapshot(
    [new HostResource({ hostId, name: "smoke", capacity: 2 })],
    [lease]
  );

  expect(seeded.resources.get("smoke")?.capacity).toBe(2);
  expect(seeded.leases.has("req-1")).toBe(true);
});
