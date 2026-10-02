import { expect, test } from "bun:test";
import {
  Attempt,
  AttemptCause,
  AttemptId,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  HostId,
  HostInfo,
  SessionId,
  TaskId,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ConnectionStatus } from "../HostConnection.ts";
import { connectionObservations } from "./connections.ts";

const owner = HostId.make("owner");

const worker = HostId.make("worker");

const time = "2026-10-01T00:00:00.000Z";

const graph = (id: string) =>
  new Constellation({
    id: ConstellationId.make("graph"),
    workspaceId: WorkspaceId.make("ws"),
    hostId: owner,
    leadSessionId: SessionId.make("lead"),
    name: "Build",
    state: "running",
    revision: 0,
    settings: ConstellationSettings.make({}),
    tasks: [],
    pendingNotifications: [],
    createdAt: time,
    updatedAt: time,
    attempts: [
      Attempt.make({
        id: AttemptId.make(id),
        taskId: TaskId.make("A"),
        revision: 0,
        cause: AttemptCause.cases.Initial.make({}),
        by: SessionId.make("lead"),
        sessionId: SessionId.make(id),
        hostId: worker,
        worktree: "/tmp",
        branch: "worker",
        base: "base",
        state: "working",
        claimedAt: null,
        approvedByUserAt: null,
        handedUpAt: null,
        handedUpReason: null,
        nudgedAt: null,
        startedAt: time,
      }),
    ],
  });

const status = (state: ConnectionStatus["state"]): ConnectionStatus => ({
  state,
  failure: null,
  attempt: 0,
  since: 0,
  nextAttemptAt: null,
  epoch: 1,
  latencyMs: null,
  lastSeenAt: null,
  capabilities: ["constellation"],
  host: new HostInfo({
    hostId: worker,
    hostname: "worker",
    platform: "darwin-arm64",
    daemonVersion: "0",
    homeDir: "/tmp",
    startedAt: time,
  }),
});

test("only observed Offline/Connected state relays, with owner reconnect/new Attempt replay and failed-send retry", async () => {
  const observations = connectionObservations();
  const sent: boolean[] = [];
  let epoch = 1;
  let fail = true;

  const byId = () => ({
    epoch,
    observe: ({ offline }: { offline: boolean }) =>
      fail
        ? Effect.fail("owner unavailable")
        : Effect.sync(() => {
            sent.push(offline);
          }),
  });

  const publish = (id = "a1") => Effect.runPromise(observations.publish([graph(id)], byId));
  observations.observe(status("reconnecting"));
  await publish();
  expect(sent).toEqual([]);
  observations.observe(status("offline"));
  await publish();
  expect(sent).toEqual([]);
  fail = false;
  await publish();
  await publish();
  expect(sent).toEqual([true]);
  await publish("a2");
  expect(sent).toEqual([true, true]);
  epoch++;
  await publish("a2");
  expect(sent).toEqual([true, true, true]);
  observations.observe(status("connected"));
  await publish("a2");
  expect(sent.at(-1)).toBe(false);
});
