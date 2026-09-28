/**
 * `polaris bridge` when no Daemon answers: on a Host with the fallback
 * supervisor it starts `~/.polaris/bin/polaris-supervise`, waits for the
 * socket and tries once more before exiting 69.
 *
 * The bridge runs as its own process (fixtures/bridge.ts): under `bun test`,
 * a failed `node:net` connect to a Unix socket fails the test even when the
 * error is handled. The supervisor is a stand-in script that starts
 * fixtures/echo-daemon.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol";

const BRIDGE = join(import.meta.dir, "fixtures", "bridge.ts");
const ECHO = join(import.meta.dir, "fixtures", "echo-daemon.ts");

const homes: Array<string> = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    const pidFile = join(home, "echo.pid");
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, "utf8").trim()));
      } catch {}
    }
    rmSync(home, { recursive: true, force: true });
  }
});

const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** A POLARIS_HOME whose supervisor (if `script`) runs `script`, logging each start. */
const makeHome = (script: ((home: string) => string) | null) => {
  const home = mkdtempSync(join(tmpdir(), "polaris-bridge-"));
  homes.push(home);
  if (script !== null) {
    mkdirSync(join(home, "bin"));
    writeFileSync(
      join(home, "bin", "polaris-supervise"),
      `#!/bin/sh\necho start >> ${q(join(home, "starts.log"))}\n${script(home)}\n`,
      { mode: 0o755 }
    );
  }
  return home;
};

const starts = (home: string) => {
  const log = join(home, "starts.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
};

const bridge = async (home: string, input: string, waitMs: number) => {
  const child = Bun.spawn([process.execPath, BRIDGE, String(waitMs)], {
    env: { ...process.env, POLARIS_HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(input);
  await child.stdin.flush();
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

describe("polaris bridge without a Daemon", () => {
  test("starts the fallback supervisor, waits for the socket and connects", async () => {
    const home = makeHome(
      (dir) =>
        `POLARIS_HOME=${q(dir)} nohup ${q(process.execPath)} ${q(ECHO)} >/dev/null 2>&1 &\necho $! > ${q(join(dir, "echo.pid"))}`
    );
    const result = await bridge(home, "hello\n", 5000);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(starts(home)).toBe(1);
  });

  test("exits 69 when the supervisor does not bring a Daemon up in time", async () => {
    const home = makeHome(() => "exit 0");
    const at = Date.now();
    const result = await bridge(home, "hello\n", 300);
    expect(result.code).toBe(BRIDGE_EXIT_NO_DAEMON);
    expect(result.stderr).toContain("no Daemon is running");
    expect(starts(home)).toBe(1);
    expect(Date.now() - at).toBeGreaterThanOrEqual(300);
  });

  test("exits 69 at once on a Host without the fallback supervisor", async () => {
    const home = makeHome(null);
    const result = await bridge(home, "hello\n", 5000);
    expect(result.code).toBe(BRIDGE_EXIT_NO_DAEMON);
    expect(result.stderr).toContain("no Daemon is running");
  });
});
