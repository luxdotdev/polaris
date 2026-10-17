import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { system32 } from "../../platform/processes.ts";
import {
  isInTree,
  ownsListen,
  parseListeners,
  windowsServerArgv,
  writeToken,
} from "./windowsServer.ts";

const windowsOnly = test.skipIf(process.platform !== "win32");

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the Windows app-server launch", () => {
  test("binds a port itself and lets in only a holder of the token", () => {
    const argv = windowsServerArgv({ codexPath: "codex.cmd", tokenFile: "C:\\h\\t" });
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

  test("counts when it is the started process or below it, not beside it", () => {
    const table = "100 4\n200 100\n9360 200\n555 4\n7 8\n8 7";

    expect(isInTree(table, 100, 9360)).toBe(true);
    expect(isInTree(table, 100, 555)).toBe(false);
    expect(isInTree(table, 100, 7)).toBe(false);
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

describe("the token file", () => {
  windowsOnly("only this user may read it, nothing inherited", () => {
    const dir = mkdtempSync(join(tmpdir(), "pas-token-"));
    dirs.push(dir);
    const file = join(dir, "codex-app-server.token");

    writeToken(file);

    const entries = Bun.spawnSync([system32("icacls.exe"), file])
      .stdout.toString()
      .split(/\r?\n/)
      .map((line) => line.replace(file, "").trim())
      .filter((line) => line.includes(":("));

    expect(readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain(`${userInfo().username}:(F)`);
  });
});
