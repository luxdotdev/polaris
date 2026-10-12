import { describe, expect, test } from "bun:test";
import { C1, HOSTS, MODELS } from "../../sessions/preview/fixtures.ts";
import { turnsOf } from "./summary.ts";

describe("turnsOf", () => {
  const all = turnsOf({ hosts: HOSTS, models: MODELS, views: {} });

  const workers = new Set<string>(
    C1.constellation.attempts
      .map((a) => a.sessionId)
      .filter((id) => id !== C1.constellation.leadSessionId)
  );

  test("lists Working and Idle sessions only, with their Host and Harness names", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => t.state === "working" || t.state === "idle")).toBe(true);
    expect(all.every((t) => t.hostLabel.length > 0 && t.harness.length > 0)).toBe(true);
  });

  test("leaves out Constellation workers but keeps their Lead", () => {
    const shown = turnsOf({ hosts: HOSTS, models: MODELS, views: { local: [C1] } });

    expect(all.some((t) => workers.has(t.sessionId))).toBe(true);
    expect(shown.some((t) => workers.has(t.sessionId))).toBe(false);
    expect(shown.length).toBe(all.filter((t) => !workers.has(t.sessionId)).length);
  });
});
