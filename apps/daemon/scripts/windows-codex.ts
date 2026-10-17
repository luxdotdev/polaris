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
import { join } from "node:path";
import { connectRpc, socketTransport } from "@polaris/client";
import { localEndpoint } from "@polaris/protocol/endpoint";
import { Effect, Option, Predicate, Schema, Stream } from "effect";
import {
  acquireAppServer,
  defaultStateFile,
  readAppServerState,
  remoteTuiArgv,
  stopAppServer,
} from "../src/harness/codex/AppServer.ts";
import { attachTerminal } from "../../../packages/client/src/terminal.ts";

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

const program = Effect.gen(function* () {
  const threadId = yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* acquireAppServer({ codexPath, socketPath, spawn: true });
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

      return { id, argv: remoteTuiArgv(server, codexPath, id) };
    })
  );

  const state = readAppServerState(stateFile);
  check("it outlives the connection that started it", state !== null && isRunning(state.pid));
  yield* Effect.scoped(throughDaemon(threadId.argv));

  const { stopped } = yield* stopAppServer({ stateFile, socketPath });
  yield* Effect.sleep("1 second");
  check("stopping it ends it", stopped !== null && !isRunning(stopped), `pid ${stopped}`);
});

await Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

process.exit();
