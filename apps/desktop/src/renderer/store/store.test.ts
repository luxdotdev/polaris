import { describe, expect, test } from "bun:test";
import { DomainEvent, HostStreamItem, SessionStreamItem } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import { envelope, seq, session, sessionId, workspace } from "./fixtures.testing.ts";
import { initialState, reduceUpdates, sessionKey } from "./store.ts";

const host: HostView = {
  key: "local",
  label: "This Mac",
  colour: null,
  alias: null,
  proofHarness: true,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 1,
    latencyMs: null,
  },
};

describe("store updates", () => {
  test("one frame's updates fold per Host and per session, and keep untouched slices", () => {
    const key = sessionKey("local", sessionId);
    const other = { ...initialState.hostModels };

    const state = reduceUpdates(initialState, [
      { kind: "hosts", hosts: [host] },
      {
        kind: "host",
        hostKey: "local",
        item: HostStreamItem.cases.Snapshot.make({
          sequence: seq(1),
          workspaces: [workspace],
          worktrees: [],
          sessions: [],
        }),
      },
      {
        kind: "session",
        key,
        item: SessionStreamItem.cases.Snapshot.make({
          sequence: seq(1),
          session,
          turns: [],
          pendingApprovals: [],
        }),
      },
      {
        kind: "host",
        hostKey: "local",
        item: HostStreamItem.cases.Event.make({
          envelope: envelope(2, DomainEvent.cases.SessionCreated.make({ session })),
        }),
      },
    ]);

    expect(state.hosts).toEqual([host]);
    expect(state.hostModels.local?.sequence).toBe(seq(2));
    expect(state.hostModels.local?.sessions.size).toBe(1);
    expect(state.sessions[key]?.session?.id).toBe(sessionId);
    expect(other).toEqual({});

    const next = reduceUpdates(state, [{ kind: "hosts", hosts: [] }]);

    expect(next.hostModels.local).toBe(state.hostModels.local);
    expect(next.sessions[key]).toBe(state.sessions[key]);
  });
});
