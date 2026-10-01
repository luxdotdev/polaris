import { describe, expect, test } from "bun:test";
import { HostId } from "@polaris/protocol";
import {
  capLine,
  holdLine,
  isAutomatic,
  type HostResourcesSnapshot,
  RESOURCE_NAME,
  resourceRows,
  validCapacity,
} from "./resources.ts";

const host = HostId.make("h");

const snapshot: HostResourcesSnapshot = {
  resources: [
    { hostId: host, name: "smoke", capacity: 1 },
    { hostId: host, name: "bench", capacity: 2, holdLimitMs: 600_000 },
  ],
  resourceLeases: [
    {
      id: "r2",
      hostId: host,
      resource: "bench",
      sessionId: null,
      attemptId: null,
      command: ["bun", "run", "bench"],
      processId: 2,
      acquiredAt: "2026-10-01T10:05:00.000Z",
    },
    {
      id: "r1",
      hostId: host,
      resource: "bench",
      sessionId: null,
      attemptId: null,
      command: ["bun", "run", "smoke"],
      processId: 1,
      acquiredAt: "2026-10-01T10:00:00.000Z",
    },
  ],
  waiting: [{ resource: "bench", requestId: "r3" }],
  overdueLeaseIds: ["r1"],
  workerCap: { cap: 4, default: 4, working: 2, waiting: 0 },
};

describe("resourceRows", () => {
  const rows = resourceRows(snapshot, (l) => (l.id === "r1" ? "B2" : null));

  test("by name, holders oldest first, overdue marked, the queue counted", () => {
    expect(rows.map((r) => r.name)).toEqual(["bench", "smoke"]);
    expect(rows[0]?.holders.map((h) => [h.who, h.overdue])).toEqual([
      ["B2", true],
      ["a command", false],
    ]);
    expect(rows[0]?.holdLimitMs).toBe(600_000);
    expect(rows[1]?.holdLimitMs).toBe(30 * 60_000);
  });

  test("lines", () => {
    expect(rows[0] === undefined ? "" : holdLine(rows[0])).toBe(
      "held by B2, held by a command · 1 waiting"
    );
    expect(rows[1] === undefined ? "" : holdLine(rows[1])).toBe("free");
    expect(capLine(snapshot.workerCap)).toBe("2 of 4 working");
    expect(isAutomatic(snapshot.workerCap)).toBe(true);
    expect(isAutomatic({ cap: 2, default: 4, working: 2, waiting: 1 })).toBe(false);
    expect(capLine({ cap: 2, default: 4, working: 2, waiting: 1 })).toBe(
      "2 of 2 working · 1 waiting for a slot"
    );
  });
});

test("names and capacities polaris lease accepts", () => {
  expect(RESOURCE_NAME.test("bench")).toBe(true);
  expect(RESOURCE_NAME.test("gpu.0_a-b")).toBe(true);
  expect(RESOURCE_NAME.test("-x")).toBe(false);
  expect(RESOURCE_NAME.test("two words")).toBe(false);
  expect([0, 1, 1.5, 64, 65].map(validCapacity)).toEqual([false, true, false, true, false]);
});
