/**
 * The shared Codex app-server on a Windows Host, through the Daemon's own code:
 *
 *   bun apps/daemon/scripts/windows-codex.ts <POLARIS_HOME> <codex> <cwd>
 *
 * Starts it as a Daemon would (`acquireAppServer`), starts a thread on it (no
 * Turn, nothing billed), then has the running Daemon on <POLARIS_HOME> list
 * Codex's Models and open the co-attached TUI in a terminal. Last it stops the
 * server and checks nothing of it is left running.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectRpc, socketTransport } from "@polaris/client";
import { localEndpoint } from "@polaris/protocol/endpoint";
import { Effect, Option, Predicate, Result, Schema, Stream } from "effect";
import {
  acquireAppServer,
  type AppServer,
  type AppServerState,
  connectAppServer,
  defaultStateFile,
  readAppServerState,
  remoteTuiArgv,
  stopAppServer,
  tokenFileOf,
} from "../src/harness/codex/AppServer.ts";
import { attachTerminal } from "../../../packages/client/src/terminal.ts";
import { listenerOn } from "../src/harness/codex/windowsServer.ts";
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

/** Something else on the recorded port: the Daemon refuses it before the token goes out. */
const squatterGetsNothing = (state: AppServerState) =>
  Effect.gen(function* () {
    let received = 0;

    const squatter = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: (_socket, data) => void (received += data.length) },
    });

    writeFileSync(
      stateFile,
      JSON.stringify({ ...state, listen: `ws://127.0.0.1:${squatter.port}` })
    );
    const result = yield* Effect.result(Effect.scoped(connectAppServer(socketPath, stateFile)));
    yield* Effect.sleep("500 millis");
    squatter.stop(true);
    writeFileSync(stateFile, JSON.stringify(state));

    check(
      "a squatter on the recorded port is refused and sent nothing",
      Result.isFailure(result) && received === 0,
      `${Result.isFailure(result) ? result.failure.message : "connected"}; ${received} bytes`
    );
  });

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
});

await Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

process.exit();
