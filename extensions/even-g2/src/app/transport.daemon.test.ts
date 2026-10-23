/**
 * The connection log over a real gateway: it names the socket it opened, and
 * when the Daemon goes away, how the socket ended and what it carried.
 */
import { expect, test } from "bun:test";
import { createPolarisWith } from "@polaris/sdk";
import { launchDaemon } from "../../../../packages/sdk/src/daemon.testing.ts";
import { loggedTransport } from "./transport.ts";

test("the log says which socket opened, and how it ended when the Daemon stopped", async () => {
  const daemon = await launchDaemon();
  const lines: Array<string> = [];

  try {
    const pairing = await daemon.pair("Even G2", ["read"], "gateway");

    const polaris = await createPolarisWith(
      { pairings: [pairing], clientName: "even-g2-tests" },
      loggedTransport((line) => lines.push(line))
    );

    for await (const view of polaris.subscribeHost(daemon.hostId)) if (view.connected) break;
    await daemon.stop();

    const deadline = Date.now() + 10_000;

    while (!lines.some((line) => line.startsWith("socket")) && Date.now() < deadline)
      await Bun.sleep(50);
    await polaris.close();
  } finally {
    await daemon.stop();
  }

  expect(lines[0]).toMatch(/^opening ws:\/\/127\.0\.0\.1:\d+\/polaris\/rpc$/);
  expect(lines[1]).toMatch(/^opened ws:/);
  expect(lines.find((line) => line.startsWith("socket"))).toMatch(
    /^socket failed: the gateway closed the connection \(1001 the Daemon is stopping\); [1-9]\d* bytes in, [1-9]\d* out$/
  );
}, 60_000);
