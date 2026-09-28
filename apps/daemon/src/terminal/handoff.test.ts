/**
 * Terminals across Daemon restarts, with a real fixture Daemon:
 * - an execve upgrade keeps the shell, its state, the scrollback, input,
 *   resize and the exit code;
 * - a crash ends terminals cleanly: the next Daemon reports them ended.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { Effect } from "effect";
import { CommandRunner } from "../service/CommandRunner.ts";
import { runtimePlatform } from "../service/platform.ts";
import { requestUpgrade, runningDaemonPid } from "../service/upgrade.ts";

const fixture = join(import.meta.dir, "fixtures", "terminal-daemon.ts");

const platform = runtimePlatform();

let home: string;

let daemon: Subprocess | null = null;

const previousHome = process.env.POLARIS_HOME;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "polaris-term-up-")));
  process.env.POLARIS_HOME = home;
});

afterEach(async () => {
  daemon?.kill("SIGKILL");
  await daemon?.exited;
  daemon = null;

  if (previousHome === undefined) delete process.env.POLARIS_HOME;
  else process.env.POLARIS_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const socketPath = () => join(home, "daemon.sock");

/** One request to the fixture Daemon. */
const call = <A = unknown>(request: Record<string, unknown>): Promise<A> =>
  new Promise((resolve, reject) => {
    let buffered = "";
    Bun.connect({
      unix: socketPath(),
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(request)}\n`);
        },
        data(socket, data) {
          buffered += data.toString();

          if (buffered.includes("\n")) {
            resolve(JSON.parse(buffered.slice(0, buffered.indexOf("\n"))));
            socket.end();
          }
        },
        close() {
          reject(new Error("closed before answering"));
        },
        connectError(_socket, error) {
          reject(error);
        },
      },
    }).catch(reject);
  });

const waitFor = async (condition: () => boolean | Promise<boolean>, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(30);
  }
};

const readUntil = async (id: string, needle: string | RegExp) => {
  let text = "";
  await waitFor(async () => {
    text = await call<string>({ op: "read", id });

    return typeof needle === "string" ? text.includes(needle) : needle.test(text);
  }).catch(() => {
    throw new Error(`timed out waiting for ${needle}; got ${JSON.stringify(text)}`);
  });

  return text;
};

const start = async (version: string) => {
  daemon = Bun.spawn([process.execPath, fixture, "--as", version], {
    env: { ...process.env, POLARIS_HOME: home },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(() => existsSync(socketPath()) && runningDaemonPid() !== null);
  await waitFor(() =>
    call({ op: "info" }).then(
      () => true,
      () => false
    )
  );
};

describe("terminals across Daemon restarts", () => {
  test("an execve upgrade keeps the shell, its scrollback, input, resize and exit code", async () => {
    await start("1.0.0");
    const id = await call<string>({ op: "open", cwd: home });
    await call({ op: "input", id, text: "X=kept; echo ready-$$\n" });
    const before = await readUntil(id, /ready-\d+/);
    const shellPid = before.match(/ready-(\d+)/)![1];

    const next = join(home, "polaris-2.0.0");
    writeFileSync(
      next,
      `#!/bin/sh
if [ "$1" = version ]; then echo "polaris 2.0.0 ${platform}"; exit 0; fi
exec "${process.execPath}" "${fixture}" --as 2.0.0
`
    );
    chmodSync(next, 0o755);

    const status = await Effect.runPromise(
      requestUpgrade({ pid: daemon!.pid, binary: next, version: "2.0.0" }).pipe(
        Effect.provide(CommandRunner.layer)
      )
    );

    expect(status).toMatchObject({ state: "done", pid: daemon!.pid });
    expect(await call({ op: "info" })).toMatchObject({ version: "2.0.0", adopted: true });

    // Same terminal id, scrollback replayed, same shell with its variables.
    expect(await call<string>({ op: "read", id })).toContain(`ready-${shellPid}`);
    await call({ op: "input", id, text: "echo $X-after-$$\n" });
    await readUntil(id, `kept-after-${shellPid}`);

    await call({ op: "resize", id, cols: 100, rows: 40 });
    await Bun.sleep(200); // the adopted PTY resizes through stty
    await call({ op: "input", id, text: "stty size\n" });
    await readUntil(id, "40 100");

    await call({ op: "input", id, text: "exit 3\n" });
    await readUntil(id, "<exit 3>");
    const list = await call<Array<{ id: string; endedBy: string }>>({ op: "list" });
    expect(list.find((t) => t.id === id)).toMatchObject({ exit: { code: 3 }, endedBy: "exit" });
  }, 30_000);

  test("a crash ends terminals; the next Daemon reports them ended in their cwd", async () => {
    await start("1.0.0");
    const id = await call<string>({ op: "open", cwd: home });
    await call({ op: "input", id, text: "echo alive\n" });
    await readUntil(id, "alive");
    daemon!.kill("SIGKILL");
    await daemon!.exited;

    await start("1.0.0");
    expect(await call<string>({ op: "read", id })).toBe("<exit null>");
    const list = await call<Array<Record<string, unknown>>>({ op: "list" });
    expect(list.find((t) => t.id === id)).toMatchObject({
      cwd: home,
      exit: { code: null },
      endedBy: "daemon-restart",
    });
  }, 30_000);
});
