/**
 * Attach and the mic against a real Daemon through the app's HostConnection and the dev bridge:
 * a pick stages on the Host and rides along with Start; a Host without a key says so.
 */
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { SessionId, SessionStreamItem, WorkspaceId } from "@polaris/protocol";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect, Option, Stream } from "effect";
import { startDevBridge, type DevBridgeServer } from "./devBridge.ts";
import { attachmentStore, stagedIds, stagePicked } from "../src/composer/attach.ts";
import { startDictation } from "../src/composer/voice.ts";
import { devBridgeTransport } from "../src/runtime/devBridge.ts";
import { type HostConnection, openHostConnection } from "../src/runtime/hostConnection.ts";
import { newSessionApi } from "../src/newSession/connect.ts";
import { newCommandId } from "../src/newSession/latch.ts";
import { defaultHarness, harnessOptions } from "../src/newSession/harness.ts";
import { newSessionId, startCommand } from "../src/newSession/model.ts";

let daemon: TestDaemon;

let bridge: DevBridgeServer;

let connection: HostConnection;

let workspaceId: WorkspaceId;

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
  workspaceId = WorkspaceId.make(await daemon.registerWorkspace());
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

const NOTES = new TextEncoder().encode("Resume from the last acknowledged frame.\n");

const firstTurn = async (sessionId: SessionId) => {
  for (let i = 0; i < 100; i++) {
    const turn = await connection.run((client) =>
      client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
        Stream.filter(SessionStreamItem.guards.Snapshot),
        Stream.runHead,
        Effect.map((snapshot) => Option.getOrThrow(snapshot).turns[0]?.turn ?? null)
      )
    );

    if (turn !== null) return turn;
    await Bun.sleep(100);
  }

  throw new Error("the session never began a Turn");
};

test("a picked file stages on the Host and Start carries it into the first Turn", async () => {
  const target = { connection, workspaceId, sessionId: null };
  const store = attachmentStore((picked) => stagePicked(target, picked, async () => NOTES));

  store.add([
    {
      uri: "file:///notes.txt",
      name: "notes.txt",
      mimeType: "text/plain",
      size: null,
      isImage: false,
    },
  ]);

  while (store.chips()[0]?.status === "staging") await Bun.sleep(20);
  const [chip] = store.chips();

  expect(chip).toMatchObject({ status: "staged", name: "notes.txt", size: NOTES.byteLength });
  expect(await Bun.file(chip?.attachment?.hostPath ?? "").text()).toBe(
    new TextDecoder().decode(NOTES)
  );

  const api = newSessionApi([connection]);
  const harness = defaultHarness(harnessOptions(await api.availability(daemon.hostId)), new Map());

  if (harness === null) throw new Error("no harness ready on the test Daemon");
  const sessionId = newSessionId();

  await api.dispatch(
    daemon.hostId,
    newCommandId(),
    startCommand({
      sessionId,
      workspaceId,
      harness,
      model: null,
      prompt: "Summarise the attached notes",
      newWorktree: false,
      planFirst: false,
      capabilities: connection.status().capabilities,
      attachments: stagedIds(store.chips()),
    })
  );

  expect((await firstTurn(sessionId)).attachments.map((a) => a.name)).toEqual(["notes.txt"]);
}, 60_000);

test("dictating on a Host without a voice key ends with the Host's own message", async () => {
  const failure = await new Promise<string | null>((resolve) => {
    const dictation = startDictation(connection, { heard: () => undefined, ended: resolve });

    dictation.push(new Uint8Array(3200));
    dictation.finish();
  });

  expect(failure).toStartWith("No Deepgram key on this Host.");
}, 30_000);
