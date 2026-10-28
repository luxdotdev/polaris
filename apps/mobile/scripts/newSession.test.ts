/**
 * The sheet's calls against the real Daemon through the app's HostConnection and the dev bridge:
 * Start makes an agent session in the chosen workspace, with the Harness, Model and placement picked.
 */
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { SessionId, SessionStreamItem, WorkspaceId } from "@polaris/protocol";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect, Option, Stream } from "effect";
import { startDevBridge, type DevBridgeServer } from "./devBridge.ts";
import { devBridgeTransport } from "../src/runtime/devBridge.ts";
import { type HostConnection, openHostConnection } from "../src/runtime/hostConnection.ts";
import { newSessionApi, sheetHost } from "../src/newSession/connect.ts";
import { defaultHarness, harnessOptions } from "../src/newSession/harness.ts";
import { newCommandId } from "../src/newSession/latch.ts";
import {
  branchFromPrompt,
  newSessionId,
  hasPlanMode,
  planCaption,
  routeLine,
  startCommand,
} from "../src/newSession/model.ts";

let daemon: TestDaemon;

let bridge: DevBridgeServer;

let connection: HostConnection;

let workspaceId: string;

const connected = () =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("never connected")), 20_000);

    const check = () => {
      if (connection.status().state !== "connected") return;
      clearTimeout(timer);
      stop();
      resolve();
    };

    const stop = connection.subscribe(check);

    check();
  });

beforeAll(async () => {
  daemon = await launchDaemon();
  bridge = startDevBridge(daemon.socketPath);
  workspaceId = await daemon.registerWorkspace();
  connection = openHostConnection({
    hostId: daemon.hostId,
    name: "Mac Studio",
    transport: devBridgeTransport({
      hostId: daemon.hostId,
      port: bridge.port,
      token: bridge.token,
    }),
  });
  await connected();
}, 60_000);

afterAll(async () => {
  await connection.close();
  bridge.stop();
  await daemon.stop();
});

/** The session as the app's own client reads it: it announces `session.plan-mode`. */
const sessionIn = (sessionId: string) =>
  connection.run((client) =>
    client
      .subscribeSession({ sessionId: SessionId.make(sessionId), afterSequence: null, turnLimit: 0 })
      .pipe(
        Stream.filter(SessionStreamItem.guards.Snapshot),
        Stream.runHead,
        Effect.map((snapshot) => Option.getOrThrow(snapshot).session)
      )
  );

test("the Host reads as its own name on this network", () => {
  const host = sheetHost(connection, null);

  expect(routeLine(host)).toBe("Runs on Mac Studio · on this network");
  expect(planCaption(host, true)).toBe("Reads and plans; asks before it edits anything");
  expect(host.homeDir).not.toBeNull();
});

test("Start makes a real agent session on a new worktree with the chosen harness", async () => {
  const api = newSessionApi([connection]);
  const harness = defaultHarness(harnessOptions(await api.availability(daemon.hostId)), new Map());

  if (harness === null) throw new Error("no harness ready on the test Daemon");
  const { models } = await api.models(daemon.hostId, harness);
  const model = models.find((m) => !m.isDefault) ?? null;
  const sessionId = newSessionId();
  const prompt = "Sketch how the relay could resume a dropped phone connection";

  await api.dispatch(
    daemon.hostId,
    newCommandId(),
    startCommand({
      sessionId,
      workspaceId: WorkspaceId.make(workspaceId),
      harness,
      model: model?.id ?? null,
      prompt,
      newWorktree: true,
      planFirst: true,
      capabilities: connection.status().capabilities,
    })
  );

  const session = await sessionIn(sessionId);

  expect(hasPlanMode(sheetHost(connection, null))).toBe(true);
  expect(session).toMatchObject({
    workspaceId,
    harness,
    permissionMode: "plan",
    model: model?.id ?? null,
  });
  expect(session.cwd.endsWith(branchFromPrompt(prompt, sessionId))).toBe(true);
}, 60_000);
