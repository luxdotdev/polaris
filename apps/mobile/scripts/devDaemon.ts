#!/usr/bin/env bun
/**
 * A dev Daemon for the Mobile App: `polaris serve` from source on a throwaway POLARIS_HOME with
 * the scripted bench Harness, a Workspace, two agent sessions, and a read-only gateway pairing.
 *
 *   bun run --cwd apps/mobile dev:daemon
 */
import { createPolaris } from "@polaris/sdk";
import { launchDaemon } from "@polaris/sdk/testing";

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

console.log("Ctrl-C stops the Daemon.");

process.on("SIGINT", () => {
  void daemon.stop().then(() => process.exit(0));
});
