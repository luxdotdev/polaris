import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedServerPhase, type ManagedServerStatus } from "@polaris/protocol";
import { Match } from "effect";
import type { ManagedModel, PinnedFile } from "./catalog.ts";
import { ManagedServer, IDLE_UNLOAD_MS, type Timers } from "./server.ts";
import type { ManagedProcess, Spawn } from "./process.ts";

const MODEL_BYTES = Buffer.from("tiny next-edit model".repeat(40));

const ASSET_BYTES = Buffer.from("tar.gz of a server build".repeat(10));

const pinned = (name: string, bytes: Buffer): PinnedFile => ({
  name,
  url: `https://publisher.example/${name}`,
  sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

const model: ManagedModel = {
  id: "sweep-next-edit-1.5b",
  name: "Sweep Next-Edit 1.5B",
  alias: "sweep-next-edit-1.5b-q8_0",
  sizeBytes: MODEL_BYTES.length,
  serverBytes: ASSET_BYTES.length,
  licence: "Apache-2.0",
  publisher: "fixture",
  file: pinned("sweep.gguf", MODEL_BYTES),
};

const asset = pinned("llama-fixture.tar.gz", ASSET_BYTES);

/** A clock the test advances by hand; timers fire in order of their due time. */
const fakeClock = () => {
  let now = 0;
  const pending = new Map<number, { readonly at: number; readonly run: () => void }>();
  let next = 0;

  const timers: Timers = {
    after: (run, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });

      return () => {
        pending.delete(id);
      };
    },
  };

  const advance = async (ms: number) => {
    const until = now + ms;

    while (true) {
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0];

      if (due === undefined) break;

      pending.delete(due[0]);
      now = due[1].at;
      due[1].run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    now = until;
  };

  return { timers, advance, pending: () => pending.size };
};

/** Fake llama-server processes: the test decides when each listens or dies. */
const fakeProcesses = () => {
  const spawned: Array<{
    readonly args: ReadonlyArray<string>;
    readonly exit: (code: number | null) => void;
    killed: boolean;
    healthy: boolean;
  }> = [];

  const spawn: Spawn = (_command, args) => {
    const exited = Promise.withResolvers<number | null>();

    const entry = {
      args,
      exit: (code: number | null) => exited.resolve(code),
      killed: false,
      healthy: false,
    };

    spawned.push(entry);

    const child: ManagedProcess = {
      pid: spawned.length,
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("load: ggml_metal_init\nerror: out of memory\n")
          );
          controller.close();
        },
      }),
      exited: exited.promise,
      kill: () => {
        entry.killed = true;
        exited.resolve(null);
      },
    };

    return child;
  };

  const health = async () => spawned.at(-1)?.healthy === true && !spawned.at(-1)?.killed;

  return { spawn, health, spawned };
};

const scratch = () => mkdtempSync(join(tmpdir(), "pl-managed-"));

/** The build and the model already in the folder, as after a finished setup. */
const installed = (dir: string) => {
  mkdirSync(join(dir, "llama-b11429"), { recursive: true });
  writeFileSync(join(dir, "llama-b11429", "llama-server"), "#!/bin/sh\n");
  writeFileSync(join(dir, "sweep.gguf"), MODEL_BYTES);
};

const make = (dir: string, options: { readonly ramBytes?: number } = {}) => {
  const clock = fakeClock();
  const processes = fakeProcesses();
  const statuses: ManagedServerStatus[] = [];

  const server = new ManagedServer({
    ramBytes: options.ramBytes ?? 16 * 1024 ** 3,
    defaultDir: dir,
    platform: "darwin",
    arch: "arm64",
    catalog: { model, asset },
    fetch: async (url) => {
      const bytes = url.endsWith(model.file.name) ? MODEL_BYTES : ASSET_BYTES;

      return new Response(new Uint8Array(bytes), { status: 200 });
    },
    extract: async (_archive, target) => {
      mkdirSync(join(target, "llama-b11429"), { recursive: true });
      writeFileSync(join(target, "llama-b11429", "llama-server"), "#!/bin/sh\n");
    },
    spawn: processes.spawn,
    health: processes.health,
    timers: clock.timers,
    free: async () => 100 * 1024 ** 3,
    port: async () => 43210,
    rss: async () => 123_456_789,
  });

  server.watch((status) => statuses.push(status));

  return { server, clock, processes, statuses };
};

const phase = (status: ManagedServerStatus) => status.phase._tag;

const cases = ManagedServerPhase.cases;

const failureReason = (status: ManagedServerStatus) =>
  Match.value(status.phase).pipe(
    Match.tag("Failed", (failed) => failed.reason),
    Match.orElse(() => null)
  );

const failureLog = (status: ManagedServerStatus) =>
  Match.value(status.phase).pipe(
    Match.tag("Failed", (failed) => failed.log),
    Match.orElse(() => null)
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("setup downloads the build and the model, then the server is stopped until a request", async () => {
  const dir = scratch();

  try {
    const { server, statuses } = make(dir);
    expect(phase(await server.status())).toBe("Absent");
    await server.setup();
    expect(phase(await server.status())).toBe("Stopped");
    expect(existsSync(join(dir, "sweep.gguf"))).toBe(true);
    expect(existsSync(join(dir, "llama-b11429", "llama-server"))).toBe(true);
    expect(existsSync(join(dir, asset.name))).toBe(false);
    expect(statuses.map(phase)).toContain("Downloading");
    expect(server.endpoint()).toEqual({
      kind: "openai",
      url: "http://127.0.0.1:43210",
      models: [model.alias],
      managed: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a verified model already in the chosen folder counts as downloaded", async () => {
  const dir = scratch();

  try {
    installed(dir);
    const { server } = make(dir);
    const status = await server.status(dir);
    expect(phase(status)).toBe("Stopped");
    expect(status.endpoint?.url).toBe("http://127.0.0.1:43210");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a model file with the wrong bytes isn't downloaded, and one changed after the check refuses to start", async () => {
  const dir = scratch();

  try {
    installed(dir);
    writeFileSync(join(dir, "sweep.gguf"), Buffer.from("x".repeat(MODEL_BYTES.length)));
    const { server, processes } = make(dir);
    expect(phase(await server.status())).toBe("Absent");
    await server.remove();
    installed(dir);
    expect(phase(await server.status())).toBe("Stopped");
    writeFileSync(join(dir, "sweep.gguf"), MODEL_BYTES.subarray(1));

    const refused = await server.start().then(
      () => null,
      (error: Error) => error.message
    );

    expect(refused).toBe(`sweep.gguf in ${dir} doesn't match its checksum`);
    expect(processes.spawned).toHaveLength(0);
    expect(failureReason(await server.status())).toBe("checksum-mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the first request starts the server lazily and idling 15 minutes unloads it", async () => {
  const dir = scratch();

  try {
    installed(dir);
    const { server, clock, processes } = make(dir);
    await server.status();
    const started = server.start();
    await settle();
    expect(phase(await server.status())).toBe("Starting");
    expect(processes.spawned[0]?.args).toContain("--alias");
    expect(processes.spawned[0]?.args).toContain("--cache-reuse");
    processes.spawned[0]!.healthy = true;
    await clock.advance(500);
    await started;
    expect(phase(await server.status())).toBe("Serving");
    expect((await server.status()).memoryBytes).toBe(123_456_789);
    expect(server.ownsUrl("http://127.0.0.1:43210")).toBe(true);
    expect(server.ownsUrl("http://127.0.0.1:8080")).toBe(false);

    await clock.advance(IDLE_UNLOAD_MS - 1000);
    server.touch();
    await clock.advance(IDLE_UNLOAD_MS - 1000);
    expect(phase(await server.status())).toBe("Serving");
    await clock.advance(2000);
    await settle();
    expect(phase(await server.status())).toBe("Stopped");
    expect(processes.spawned[0]?.killed).toBe(true);

    const again = server.start();
    await settle();
    expect(processes.spawned).toHaveLength(2);
    processes.spawned[1]!.healthy = true;
    await clock.advance(500);
    await again;
    expect(phase(await server.status())).toBe("Serving");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a crash restarts with doubling backoff, then gives up with the server's last lines", async () => {
  const dir = scratch();

  try {
    installed(dir);
    const { server, clock, processes } = make(dir);
    await server.status();
    const started = server.start();
    started.catch(() => {});
    await settle();
    processes.spawned[0]!.healthy = true;
    await clock.advance(500);
    await started;

    processes.spawned[0]!.exit(1);
    await settle();
    expect((await server.status()).phase).toEqual(
      cases.Backoff.make({ attempt: 1, retryInMs: 1000 })
    );
    await clock.advance(999);
    expect(processes.spawned).toHaveLength(1);
    await clock.advance(1);
    await settle();
    expect(processes.spawned).toHaveLength(2);
    expect(phase(await server.status())).toBe("Starting");

    processes.spawned[1]!.exit(1);
    await settle();
    expect((await server.status()).phase).toEqual(
      cases.Backoff.make({ attempt: 2, retryInMs: 2000 })
    );

    for (const wait of [2000, 4000, 8000]) {
      await clock.advance(wait);
      await settle();
      processes.spawned.at(-1)!.exit(1);
      await settle();
    }

    const status = await server.status();
    expect(phase(status)).toBe("Failed");
    expect(failureLog(status)).toEqual(["load: ggml_metal_init", "error: out of memory"]);
    expect(processes.spawned).toHaveLength(5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turning it off stops the process and cancels a pending restart", async () => {
  const dir = scratch();

  try {
    installed(dir);
    const { server, clock, processes } = make(dir);
    await server.status();
    const started = server.start();
    started.catch(() => {});
    await settle();
    processes.spawned[0]!.healthy = true;
    await clock.advance(500);
    await started;
    processes.spawned[0]!.exit(1);
    await settle();
    expect(phase(await server.status())).toBe("Backoff");
    server.stop();
    expect(phase(await server.status())).toBe("Stopped");
    await clock.advance(60_000);
    await settle();
    expect(processes.spawned).toHaveLength(1);
    expect(clock.pending()).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remove deletes the model and the build and the status is absent again", async () => {
  const dir = scratch();

  try {
    installed(dir);
    const { server } = make(dir);
    expect(phase(await server.status())).toBe("Stopped");
    await server.remove();
    expect(phase(await server.status())).toBe("Absent");
    expect(existsSync(join(dir, "sweep.gguf"))).toBe(false);
    expect(existsSync(join(dir, "llama-b11429"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the model is picked by the machine's RAM and a platform without a build is unsupported", async () => {
  const dir = scratch();

  try {
    const big = new ManagedServer({
      ramBytes: 64 * 1024 ** 3,
      defaultDir: dir,
      platform: "darwin",
      arch: "arm64",
    });

    expect((await big.status()).model.id).toBe("zeta-2.1");

    const small = new ManagedServer({
      ramBytes: 16 * 1024 ** 3,
      defaultDir: dir,
      platform: "linux",
      arch: "x64",
    });

    expect((await small.status()).model.id).toBe("sweep-next-edit-1.5b");

    const windows = new ManagedServer({
      ramBytes: 64 * 1024 ** 3,
      defaultDir: dir,
      platform: "win32",
      arch: "x64",
    });

    expect((await windows.status()).phase).toEqual(cases.Unsupported.make({ reason: "platform" }));

    const pi = new ManagedServer({
      ramBytes: 8 * 1024 ** 3,
      defaultDir: dir,
      platform: "linux",
      arch: "arm64",
      tooSmall: true,
    });

    expect((await pi.status()).phase).toEqual(cases.Unsupported.make({ reason: "too-small" }));
    await pi.setup();
    expect((await pi.status()).phase._tag).toBe("Unsupported");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
