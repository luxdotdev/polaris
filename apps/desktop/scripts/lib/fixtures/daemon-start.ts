import { once } from "node:events";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { startDaemon } from "../daemon.ts";

const home = process.argv[2];

if (home === undefined) throw new Error("expected a temporary Daemon home");

const daemon = await startDaemon({
  home,
  benchHarness: true,
  env: process.argv[3] === "override" ? { POLARIS_HANDOFF: process.env.POLARIS_HANDOFF ?? "" } : {},
});

try {
  // Reconnect after the upgrade drain's grace period, when a stale descriptor used to exit.
  await sleep(600);
  const socket = connect(daemon.socketPath);

  try {
    await once(socket, "connect");
  } finally {
    socket.destroy();
  }
} finally {
  await daemon.stop();
}
