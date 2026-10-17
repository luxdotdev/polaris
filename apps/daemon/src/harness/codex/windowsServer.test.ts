import { describe, expect, test } from "bun:test";
import { ownsListen, parseListeners, serverArgs } from "./windowsServer.ts";

const windowsOnly = test.skipIf(process.platform !== "win32");

describe("the Windows app-server launch", () => {
  test("binds a port itself and lets in only a holder of the token", () => {
    const argv = serverArgs("C:\\h\\t");
    const option = (name: string) => argv[argv.indexOf(name) + 1];

    // Port 0: no port is picked in advance for something else to take first.
    expect(option("--listen")).toBe("ws://127.0.0.1:0");
    expect([option("--ws-auth"), option("--ws-token-file")]).toEqual([
      "capability-token",
      "C:\\h\\t",
    ]);
  });
});

describe("who holds a loopback port", () => {
  const netstat = [
    "Active Connections",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    127.0.0.1:62300        127.0.0.1:62301        ESTABLISHED     4242",
    "  TCP    0.0.0.0:62300          0.0.0.0:0              LISTENING       77",
    "  TCP    127.0.0.1:62300        0.0.0.0:0              ABHÖREN         9360",
    "  TCP    127.0.0.1:6230         0.0.0.0:0              LISTENING       5",
  ].join("\r\n");

  test("are the loopback listeners, whatever language names the state", () => {
    expect(parseListeners(netstat)).toEqual([
      { port: 62300, pid: 9360 },
      { port: 6230, pid: 5 },
    ]);
  });

  windowsOnly("a listener the recorded pid doesn't own is not trusted", () => {
    const squatter = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });

    try {
      const listen = `ws://127.0.0.1:${squatter.port}`;

      expect(ownsListen(listen, process.pid)).toBe(true);
      expect(ownsListen(listen, process.ppid)).toBe(false);
    } finally {
      squatter.stop(true);
    }
  });
});
