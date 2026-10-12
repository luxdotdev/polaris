import { describe, expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
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

  test("marks a Lead's digest-started Turn, but not a Turn a digest was steered into", () => {
    const lead = C1.constellation.leadSessionId;
    const base = { leadSessionId: lead, revision: 1, at: "2026-10-11T12:00:00Z", items: [] };
    const host = MODELS.local;
    const entry = host.sessions.get(lead);

    if (entry === undefined) throw new Error("fixture has the Lead");

    const withTurn = (turnId: string) => ({
      ...MODELS,
      local: { ...host, sessions: new Map([[lead, { ...entry, lastTurnId: turnId }]]) },
    });

    const view = {
      ...C1,
      digests: [
        { ...base, turnId: TurnId.make("t-digest") },
        { ...base, turnId: TurnId.make("t-user"), steered: true },
      ],
    };

    const flag = (turnId: string) =>
      turnsOf({ hosts: HOSTS, models: withTurn(turnId), views: { local: [view] } }).find(
        (t) => t.sessionId === lead
      )?.digestStarted;

    expect(flag("t-digest")).toBe(true);
    expect(flag("t-user")).toBe(false);
    expect(flag("t-other")).toBe(false);
  });
});
