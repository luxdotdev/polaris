#!/usr/bin/env bun
/**
 * A dev Daemon for the Mobile App: `polaris serve` from source on a throwaway POLARIS_HOME with
 * the scripted bench Harness, a Workspace, two agent sessions, a read-only gateway pairing, and the
 * dev bridge that gives the simulator a Client's power (`src/runtime/devBridge.ts`).
 *
 *   bun run --cwd apps/mobile dev:daemon
 */
import { createPolaris } from "@polaris/sdk";
import { launchDaemon } from "@polaris/sdk/testing";
import { formatDevBridge } from "../src/runtime/devBridge.ts";
import { startDevBridge } from "./devBridge.ts";

const daemon = await launchDaemon();

const workspaceId = await daemon.registerWorkspace();

const starter = await createPolaris({
  pairings: [await daemon.pair("Mobile dev setup", ["read", "approve", "start"], "gateway")],
  clientName: "Mobile dev setup",
});

for (const prompt of ["Summarise the README", "List the files"]) {
  await starter.startSession(daemon.hostId, { workspaceId, harness: "claude", prompt });
}

await starter.close();

const pairing = await daemon.pair("Polaris Mobile (dev)", ["read"], "gateway");

console.log(`Daemon home: ${daemon.home}`);

console.log(`Gateway: ${daemon.gatewayUrl}`);

console.log(`Pairing (read only):\n${pairing}`);

const bridge = startDevBridge(daemon.socketPath);

console.log(
  `Dev bridge on 127.0.0.1:${bridge.port}. Start Metro with:\nEXPO_PUBLIC_POLARIS_DEV_BRIDGE=${formatDevBridge({ hostId: daemon.hostId, port: bridge.port, token: bridge.token })}`
);

console.log("Ctrl-C stops the Daemon.");

process.on("SIGINT", () => {
  bridge.stop();
  void daemon.stop().then(() => process.exit(0));
});
