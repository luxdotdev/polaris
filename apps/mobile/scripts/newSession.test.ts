/**
 * The sheet's calls against the real Daemon through the app's HostConnection and the dev bridge:
 * Start makes an agent session in the chosen workspace, with the Harness, Model and placement picked.
 */
import { createPolaris, type PolarisClient } from "@polaris/sdk";
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { WorkspaceId } from "@polaris/protocol";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startDevBridge, type DevBridgeServer } from "./devBridge.ts";
import { devBridgeTransport } from "../src/runtime/devBridge.ts";
import { type HostConnection, openHostConnection } from "../src/runtime/hostConnection.ts";
import { newSessionApi, sheetHost } from "../src/newSession/connect.ts";
import { defaultHarness, harnessOptions } from "../src/newSession/harness.ts";
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

let observer: PolarisClient;

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
  process.env.POLARIS_HOME = daemon.home;
  observer = await createPolaris({
    pairings: [await daemon.pair("Observer", ["read"])],
    clientName: "sheet-tests",
  });
  await connected();
}, 60_000);

afterAll(async () => {
  await observer.close();
  await connection.close();
  bridge.stop();
  await daemon.stop();
});

const sessionIn = async (sessionId: string) => {
  for await (const view of observer.subscribeHost(daemon.hostId)) {
    const entry = view.sessions.find((e) => e.session.id === sessionId);

    if (entry !== undefined) return entry.session;
  }

  throw new Error("the feed ended");
};

test("the Host reads as its own name on this network", () => {
  const host = sheetHost(connection, null);

  expect(routeLine(host)).toBe("Runs on Mac Studio · on this network");
  expect(planCaption(host, true)).toBe(
    hasPlanMode(host) ? "Reads and plans; asks before it edits anything" : "Asks before every edit"
  );
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

  expect(session).toMatchObject({
    workspaceId,
    harness,
    // Plan mode where the Host has it (ENG-466); supervised on a Daemon without it.
    permissionMode: hasPlanMode(sheetHost(connection, null)) ? "plan" : "supervised",
    model: model?.id ?? null,
  });
  expect(session.cwd.endsWith(branchFromPrompt(prompt, sessionId))).toBe(true);
}, 60_000);
