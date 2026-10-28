import { createPolaris } from "@polaris/sdk";
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import {
  CommandId,
  ConstellationId,
  ConstellationStreamItem,
  NotificationItem,
  PlanOperation,
  SessionId,
  TaskDefinition,
  TaskId,
  WorkspaceId,
} from "@polaris/protocol";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect, Exit, Option, Stream } from "effect";
import { messageLead, sendVerdict, VerdictRefused } from "../src/constellation/verdict.ts";
import { devBridgeTransport } from "../src/runtime/devBridge.ts";
import { type HostConnection, openHostConnection } from "../src/runtime/hostConnection.ts";
import { type DevBridgeServer, startDevBridge } from "./devBridge.ts";

let daemon: TestDaemon;

let bridge: DevBridgeServer;

let connection: HostConnection;

const id = ConstellationId.make("mobile-verdicts");

beforeAll(async () => {
  daemon = await launchDaemon();
  bridge = startDevBridge(daemon.socketPath);
  const workspaceId = await daemon.registerWorkspace();

  const starter = await createPolaris({
    pairings: [await daemon.pair("setup", ["read", "approve", "start"], "gateway")],
    clientName: "setup",
  });

  const lead = await starter.startSession(daemon.hostId, {
    workspaceId,
    harness: "claude",
    prompt: "Lead the overhaul",
  });

  await starter.close();
  connection = openHostConnection({
    hostId: daemon.hostId,
    name: "Dev Daemon",
    transport: devBridgeTransport({
      hostId: daemon.hostId,
      port: bridge.port,
      token: bridge.token,
    }),
  });

  while (connection.live() === null) await Bun.sleep(50);

  await connection.run((client) =>
    client["constellation.plan"]({
      commandId: CommandId.make("plan-1"),
      constellationId: id,
      start: {
        name: "Orchestrator overhaul",
        workspaceId: WorkspaceId.make(workspaceId),
        leadSessionId: SessionId.make(lead),
      },
      operations: [
        PlanOperation.cases.Add.make({
          task: new TaskDefinition({
            id: TaskId.make("B2"),
            title: "Workspace chips",
            kind: "task",
            brief: "Chips for workspaces",
          }),
        }),
      ],
    })
  );
}, 60_000);

afterAll(async () => {
  await connection.close();
  bridge.stop();
  await daemon.stop();
});

/** What the lead will be told: the operator messages queued for it. */
const toLead = () =>
  connection.run((client) =>
    client["constellation.subscribe"]({ constellationId: id, afterSequence: null }).pipe(
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.map((item) =>
        ConstellationStreamItem.guards.Snapshot(item)
          ? item.constellation.pendingNotifications.flatMap(({ item: queued }) =>
              NotificationItem.guards.OperatorMessage(queued) ? [queued.text] : []
            )
          : []
      )
    )
  );

const verdict = {
  constellationId: id,
  taskId: "B2",
  revision: 0,
  head: "3f9c2e1",
} as const;

test("send back reaches the lead as the user's verdict with their answer", async () => {
  await connection.run((client) =>
    sendVerdict(client, {
      ...verdict,
      verdict: "send-back",
      attemptId: "any",
      reply: "Wrap to two lines past four workspaces",
    })
  );

  expect(await toLead()).toContain(
    "Send back B2 (claim 3f9c2e1): Wrap to two lines past four workspaces"
  );
}, 30_000);

test("an accept the Host refuses tells the lead nothing", async () => {
  const before = await toLead();

  const exit = await connection.run((client) =>
    sendVerdict(client, { ...verdict, verdict: "accept", attemptId: "gone", reply: "Wrap" }).pipe(
      Effect.exit
    )
  );

  expect(Exit.isFailure(exit) && Exit.findErrorOption(exit).pipe(Option.getOrNull)).toBeInstanceOf(
    VerdictRefused
  );
  expect(await toLead()).toEqual(before);
}, 30_000);

test("the composer's message reaches the lead", async () => {
  await connection.run((client) => messageLead(client, id, "Hold B2 until the tokens land"));

  expect(await toLead()).toContain("Hold B2 until the tokens land");
}, 30_000);
