import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectRpc, type DaemonClient, socketTransport } from "@polaris/client";
import { CommandId } from "@polaris/protocol";
import { Effect } from "effect";

const main = resolve(import.meta.dir, "../main.ts");

const eventually = async (predicate: () => Promise<boolean>) => {
  for (let n = 0; n < 300; n++) {
    if (await predicate().catch(() => false)) return;
    await Bun.sleep(20);
  }

  throw new Error("CLI resource condition did not become true");
};

test("CLI child leases survive wrapper SIGKILL and Daemon restart, cancel dead waiters and release killed children", async () => {
  const home = mkdtempSync("/tmp/polaris-lease-cli-");

  // Poison the parent context with a valid handoff referencing an unavailable descriptor.
  const inheritedEnv = {
    ...process.env,
    POLARIS_HANDOFF: JSON.stringify({
      listenerFd: 1_000_000,
      fds: {},
      children: {},
      fromVersion: "fixture",
      requestId: null,
    }),
  };

  const env = {
    ...inheritedEnv,
    POLARIS_HANDOFF: undefined,
    POLARIS_HOME: home,
    POLARIS_HOST_SOCKET: join(home, "daemon.sock"),
    POLARIS_BINARY: undefined,
    POLARIS_LEASE_HELD: undefined,
    POLARIS_SESSION_ID: undefined,
    POLARIS_BENCH_HARNESS: "1",
  };

  let listening = false;

  const serve = () => {
    listening = false;

    const child = Bun.spawn([process.execPath, main, "serve", "--foreground"], {
      env,
      stdout: "pipe",
      stderr: "ignore",
    });

    let logs = "";
    void child.stdout
      .pipeTo(
        new WritableStream({
          write(chunk) {
            logs += new TextDecoder().decode(chunk);
            listening = logs.includes("Daemon listening on");
          },
        })
      )
      .catch(() => {});

    return child;
  };

  let daemon = serve();
  const wrappers: Bun.Subprocess[] = [];
  const childPids: number[] = [];

  const call = <A, E>(request: (client: DaemonClient) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* socketTransport(join(home, "daemon.sock"));
          const { client } = yield* connectRpc(transport);

          return yield* request(client);
        })
      ).pipe(Effect.timeout(3000))
    );

  const snapshot = () => call((client) => client["host.resources.get"]({}));

  const wrapper = (name: string) => {
    const marker = join(home, name);

    const child = Bun.spawn(
      [
        process.execPath,
        main,
        "lease",
        "bench",
        "--",
        process.execPath,
        "-e",
        'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
        marker,
      ],
      { env, stdout: "ignore", stderr: "ignore" }
    );

    wrappers.push(child);

    return { child, marker };
  };

  try {
    await eventually(async () => listening);
    expect((await snapshot()).resources).toHaveLength(0);
    await call((client) =>
      client["host.resources.declare"]({
        commandId: CommandId.make(randomUUID()),
        name: "bench",
        capacity: 1,
      })
    );

    const bench = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../../../../packages/bench/src/cli.ts"),
        "--list",
      ],
      {
        env: { ...env, POLARIS_HOST_SOCKET: join(home, "daemon.sock") },
        stdout: "pipe",
        stderr: "ignore",
      }
    );

    wrappers.push(bench);
    const listed = await new Response(bench.stdout).text();
    expect(await bench.exited).toBe(0);
    expect(listed).toContain("idle");
    const first = wrapper("first");
    await eventually(async () => existsSync(first.marker));
    const firstPid = Number(readFileSync(first.marker, "utf8"));
    childPids.push(firstPid);
    const canceled = wrapper("canceled");
    await eventually(async () => (await snapshot()).waiting.length === 1);
    const third = wrapper("third");
    await eventually(async () => (await snapshot()).waiting.length === 2);
    expect(existsSync(canceled.marker)).toBe(false);
    expect(existsSync(third.marker)).toBe(false);
    canceled.child.kill("SIGKILL");
    await canceled.child.exited;
    await eventually(async () => (await snapshot()).waiting.length === 1);
    first.child.kill("SIGKILL");
    await first.child.exited;
    expect((await snapshot()).resourceLeases[0]?.processId).toBe(firstPid);
    daemon.kill("SIGKILL");
    await daemon.exited;
    daemon = serve();
    await eventually(async () => listening);
    await eventually(async () => (await snapshot()).resourceLeases[0]?.processId === firstPid);
    expect(existsSync(third.marker)).toBe(false);
    process.kill(firstPid, "SIGKILL");
    await eventually(async () => existsSync(third.marker));
    const thirdPid = Number(readFileSync(third.marker, "utf8"));
    childPids.push(thirdPid);
    expect((await snapshot()).resourceLeases).toHaveLength(1);
    process.kill(thirdPid, "SIGKILL");
    await third.child.exited;
    await eventually(async () => (await snapshot()).resourceLeases.length === 0);

    const exited = Bun.spawn(
      [process.execPath, main, "lease", "bench", "--", process.execPath, "-e", "process.exit(7)"],
      { env, stdout: "ignore", stderr: "ignore" }
    );

    wrappers.push(exited);
    expect(await exited.exited).toBe(7);

    const unknown = Bun.spawn([process.execPath, main, "lease", "unknown", "--", "/bin/true"], {
      env,
      stdout: "ignore",
      stderr: "ignore",
    });

    wrappers.push(unknown);
    expect(await unknown.exited).toBe(1);
  } finally {
    for (const child of wrappers) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }

    for (const pid of childPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }

    daemon.kill();
    await daemon.exited;
    await Promise.all(wrappers.map((child) => child.exited));
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
