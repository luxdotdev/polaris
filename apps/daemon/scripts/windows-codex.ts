/**
 * The shared Codex app-server on a Windows Host, through the Daemon's own code:
 *
 *   bun apps/daemon/scripts/windows-codex.ts <POLARIS_HOME> <codex> <cwd>
 *
 * Starts it as a Daemon would (`acquireAppServer`), starts a thread on it (no
 * Turn, nothing billed), then has the running Daemon on <POLARIS_HOME> list
 * Codex's Models and open the co-attached TUI in a terminal. Last it stops the
 * server and checks nothing of it is left running, and that a Daemon killed
 * outright leaves no codex either.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectRpc, socketTransport } from "@polaris/client";
import { localEndpoint } from "@polaris/protocol/endpoint";
import { Effect, Option, Predicate, Result, Schema, Stream } from "effect";
import {
  acquireAppServer,
  type AppServer,
  AppServerState,
  connectAppServer,
  defaultStateFile,
  readAppServerState,
  remoteTuiArgv,
  stopAppServer,
  tokenFileOf,
} from "../src/harness/codex/AppServer.ts";
import { attachTerminal } from "../../../packages/client/src/terminal.ts";
import { listenerOn, ownsListen } from "../src/harness/codex/windowsServer.ts";
import { loopbackListeners, writePrivateFile } from "../src/platform/windowsNative.ts";
import { system32 } from "../src/platform/processes.ts";

const [home, codexPath, cwd] = process.argv.slice(2);

if (home === undefined || codexPath === undefined || cwd === undefined) {
  console.error("usage: windows-codex.ts <POLARIS_HOME> <codex> <cwd>");
  process.exit(2);
}

const decodeStarted = Schema.decodeUnknownOption(
  Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) })
);

const socketPath = join(home, "codex.sock");

const stateFile = defaultStateFile(socketPath);

const check = (what: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail === "" ? "" : `: ${detail}`}`);

  if (!ok) process.exitCode = 1;
};

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/** The Daemon lists Codex's Models and runs the TUI on `threadId` in a terminal. */
const throughDaemon = (argv: Array<string>) =>
  Effect.gen(function* () {
    const connection = yield* connectRpc(yield* socketTransport(localEndpoint(home)));
    const { client } = connection;

    const hello = yield* client.hello({
      clientName: "windows-codex",
      clientVersion: "0.2.0",
      deviceLabel: "smoke",
      capabilities: ["host.any-platform"],
    });

    const models = yield* client["harness.models"]({ harness: "codex", refresh: true });
    check(
      "the Daemon lists Codex's Models",
      models.models.length > 0,
      `${models.models.length} Models`
    );

    const { terminalId } = yield* client["terminal.open"]({ cwd, cols: 120, rows: 40, argv });
    let text = "";

    yield* attachTerminal({ ...connection, capabilities: hello.capabilities }, terminalId).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          text += Predicate.isTagged(item, "Output")
            ? new TextDecoder().decode(item.data)
            : `<exit ${item.code}>`;
        })
      ),
      Effect.forkScoped
    );

    yield* Effect.sleep("8 seconds");
    console.log(`--- TUI screen (last 600 chars)\n${Bun.stripANSI(text).slice(-600)}\n---`);
    check("the TUI is running on the shared server", !text.includes("<exit"), "");
    yield* client["terminal.close"]({ terminalId });
  });

/** The port codex bound, who holds it, and who may read the token. */
const showListener = (state: AppServerState | null) => {
  const port = state?.listen === undefined ? null : Number(new URL(state.listen).port);
  const holder = port === null ? null : listenerOn(port);

  check(
    "codex bound a port itself and holds it",
    port !== null && holder !== null && holder === state?.listenerPid,
    `${state?.listen} held by pid ${holder}, recorded ${state?.listenerPid}`
  );
  console.log(Bun.spawnSync([system32("icacls.exe"), tokenFileOf(stateFile)]).stdout.toString());
};

/** Records `state` as a Daemon would: a private file of the user's. */
const record = (state: AppServerState) => writePrivateFile(stateFile, JSON.stringify(state));

/**
 * Something else on the recorded port: the Daemon refuses it before the token goes out,
 * whether it is another pid, or has the recorded pid but not the recorded creation time.
 */
const squatterGetsNothing = (state: AppServerState) =>
  Effect.gen(function* () {
    let received = 0;

    const squatter = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: (_socket, data) => void (received += data.length) },
    });

    const listen = `ws://127.0.0.1:${squatter.port}`;

    const cases = [
      ["another process on the recorded port", { ...state, listen }],
      ["a process that took the pid and the port", { ...state, listen, listenerPid: process.pid }],
    ] as const;

    for (const [what, squatted] of cases) {
      record(squatted);
      const result = yield* Effect.result(Effect.scoped(connectAppServer(socketPath, stateFile)));
      yield* Effect.sleep("500 millis");

      check(
        `${what} is refused and sent nothing`,
        Result.isFailure(result) && received === 0,
        `${Result.isFailure(result) ? result.failure.message : "connected"}; ${received} bytes`
      );
    }

    squatter.stop(true);
    record(state);
  });

/** The per-connect check reads the TCP table in-process: no netstat, well under a millisecond. */
const timeCheck = (state: AppServerState) => {
  if (state.listen === undefined || state.listenerPid === undefined) return;
  const started = performance.now();

  for (let round = 0; round < 100; round++)
    ownsListen(state.listen, state.listenerPid, state.listenerCreated);
  const each = (performance.now() - started) / 100;

  check("the listener check is in-process and fast", each < 5, `${each.toFixed(3)} ms each`);
};

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(AppServerState));

/** A Daemon killed outright (TerminateProcess, no finalizer) takes its codex with it. */
const hardKill = async () => {
  const dir = mkdtempSync(join(tmpdir(), "pcx-"));
  const script = join(dir, "daemon.ts");
  const appServer = join(import.meta.dir, "../src/harness/codex/AppServer.ts");

  await Bun.write(
    script,
    `import { Effect } from ${JSON.stringify(Bun.resolveSync("effect", import.meta.dir))};
import { acquireAppServer, readAppServerState } from ${JSON.stringify(appServer)};
const socketPath = ${JSON.stringify(join(dir, "codex.sock"))};
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const server = yield* acquireAppServer({ codexPath: ${JSON.stringify(codexPath)}, socketPath, spawn: true });
  yield* Effect.scoped(server.connect);
  console.log(JSON.stringify(readAppServerState(server.stateFile)));
  yield* Effect.never;
})));`
  );
  const daemon = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" });
  const { value } = await daemon.stdout.getReader().read();
  const state = decodeState(new TextDecoder().decode(value).trim());
  const port = Number(new URL(state.listen ?? "ws://127.0.0.1:0").port);

  const before = [state.pid, state.listenerPid].filter(
    (pid) => pid !== undefined && isRunning(pid)
  );

  daemon.kill("SIGKILL");
  await Bun.sleep(1500);
  const left = [state.pid, state.listenerPid].filter((pid) => pid !== undefined && isRunning(pid));
  const holder = loopbackListeners().find((listener) => listener.port === port);

  check(
    "a Daemon killed outright leaves no codex and frees its port",
    before.length === 2 && left.length === 0 && holder === undefined,
    `running before: ${before.join(",")}; left: ${left.join(",") || "none"}; port ${port} ${holder === undefined ? "free" : `held by ${holder.pid}`}`
  );
  rmSync(dir, { recursive: true, force: true });
};

/** The first connection: a thread started on the server, closed before the rest. */
const startThread = (server: AppServer) =>
  Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* server.connect;

      yield* conn.request("initialize", {
        clientInfo: { name: "polaris", title: "Polaris", version: "0.2.0" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      yield* conn.notify("initialized");
      const state = readAppServerState(stateFile);
      check("the server started", state !== null && isRunning(state.pid), JSON.stringify(state));
      const account = yield* conn.request("account/read", { refreshToken: false });
      console.log(`account/read: ${JSON.stringify(account).slice(0, 200)}`);

      const started = decodeStarted(yield* conn.request("thread/start", { cwd }));
      const id = Option.match(started, { onNone: () => "", onSome: (s) => s.thread.id });

      check("a thread starts on it", id !== "", id);

      return remoteTuiArgv(server, codexPath, id);
    })
  );

/** Everything runs while the server is held, as a Daemon holds it for its lifetime. */
const program = Effect.gen(function* () {
  const stopped = yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* acquireAppServer({ codexPath, socketPath, spawn: true });
      const argv = yield* startThread(server);
      const state = readAppServerState(stateFile);

      check("it outlives the connection that started it", state !== null && isRunning(state.pid));
      showListener(state);
      yield* Effect.scoped(throughDaemon(argv));

      if (state !== null) yield* squatterGetsNothing(state);

      if (state !== null) timeCheck(state);

      return state;
    })
  );

  // On Windows letting go of it stops it, its listener too; elsewhere stop it as uninstall does.
  if (process.platform !== "win32") yield* stopAppServer({ stateFile, socketPath });
  yield* Effect.sleep("1 second");

  const left = [stopped?.pid, stopped?.listenerPid].filter(
    (pid) => pid !== undefined && isRunning(pid)
  );

  check(
    "letting it go ends it, listener included",
    stopped !== null && left.length === 0,
    `left: ${left.join(",") || "none"}`
  );

  yield* Effect.promise(hardKill);
});

await Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

process.exit();
