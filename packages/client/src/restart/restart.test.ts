import { describe, expect, test } from "bun:test";
import {
  type ByteTransport,
  Hello,
  HostId,
  HostInfo,
  makeWire,
  type Wire,
  PrepareRestart,
  PROTOCOL_VERSION,
  type TransportError,
} from "@polaris/protocol";
import {
  type Cause,
  Data,
  Effect,
  Exit,
  Predicate,
  Queue,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { RpcSerialization } from "effect/rpc";
import type { ExitEncoded, FromServerEncoded } from "effect/rpc/RpcMessage";
import type { ConnectionState } from "@polaris/protocol";
import { ConnectFailure } from "../failures.ts";
import { HostTarget, makeHostConnection } from "../HostConnection.ts";
import type { SshResult } from "../install/Ssh.ts";
import { SshError } from "../install/Ssh.ts";
import type { ClientTransport } from "../transport.ts";
import {
  RestartFailed,
  type RestartRunner,
  restartDaemon,
  SERVICE_PROBE,
  TaskConflict,
} from "./index.ts";
import { shScript } from "../install/Ssh.ts";

const Sent = Schema.Struct({
  _tag: Schema.String,
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  tag: Schema.optional(Schema.String),
});

const decodeSent = Schema.decodeUnknownSync(Schema.fromJsonString(Sent));

const serialization = RpcSerialization.json.makeUnsafe();

const encodeJson = (message: FromServerEncoded): string => {
  const encoded = serialization.encode(message);

  if (!Predicate.isString(encoded)) throw new Error("the JSON serialization encodes to strings");

  return encoded;
};

const { Exit: ResponseExit, Pong } = Data.taggedEnum<FromServerEncoded>();

const { Success } = Data.taggedEnum<ExitEncoded<unknown, unknown>>();

const helloAnswer = (startedAt: string) =>
  Success({
    value: Schema.encodeSync(Schema.toCodecJson(Hello.successSchema))({
      host: new HostInfo({
        hostId: HostId.make("studio"),
        hostname: "studio",
        platform: "darwin-arm64",
        daemonVersion: "0.5.0",
        homeDir: "/Users/lucas",
        startedAt,
      }),
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ["host.restart"],
    }),
  });

const prepareAnswer = Success({
  value: Schema.encodeSync(Schema.toCodecJson(PrepareRestart.successSchema))({
    interruptedTurns: 2,
  }),
});

type Pipe = Queue.Queue<Uint8Array, TransportError | Cause.Done>;

const LOST = new ConnectFailure({ kind: "transient", reason: "connection-lost", detail: "fake" });

/**
 * The Host as the boundary sees it: a fake Daemon behind the connector (answering `hello`,
 * pings and `host.prepareRestart`), and the service manager that kills and restarts it.
 */
const fakeHost = (options: { readonly comesBack: boolean; readonly up: boolean }) => {
  const log: Array<string> = [];
  let generation = options.up ? 1 : 0;
  let current: { readonly kill: () => void } | null = null;
  let down = !options.up;

  const daemon = (startedAt: string) =>
    Effect.gen(function* () {
      const toPeer: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();
      const toClient: Pipe = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();

      const side = (inbox: Pipe, outbox: Pipe): ByteTransport => ({
        incoming: Stream.fromQueue(inbox),
        write: (bytes) => Effect.sync(() => Queue.offerUnsafe(outbox, bytes)),
        close: Effect.sync(() => Queue.endUnsafe(outbox)),
      });

      const peer: Wire = yield* makeWire(side(toPeer, toClient), (text) =>
        Effect.suspend(() => {
          const message = decodeSent(text);

          if (Predicate.isTagged(message, "Ping"))
            return Effect.ignore(peer.sendJson(encodeJson(Pong())));

          if (message.tag === "host.prepareRestart") log.push("prepare");

          const answers = new Map([
            ["hello", helloAnswer(startedAt)],
            ["host.prepareRestart", prepareAnswer],
          ]);

          const exit = message.tag === undefined ? undefined : answers.get(message.tag);

          return message.id === undefined || exit === undefined
            ? Effect.void
            : Effect.ignore(
                peer.sendJson(encodeJson(ResponseExit({ requestId: message.id, exit })))
              );
        })
      );

      current = { kill: () => Queue.endUnsafe(toClient) };

      return {
        ...side(toClient, toPeer),
        diagnose: Effect.succeed(LOST),
      } satisfies ClientTransport;
    });

  const connector: Effect.Effect<ClientTransport, ConnectFailure, Scope.Scope> = Effect.suspend(
    () =>
      down
        ? Effect.fail(
            new ConnectFailure({
              kind: "needs-attention",
              reason: "daemon-not-running",
              detail: "no Daemon is running on this Host",
            })
          )
        : daemon(`2026-10-29T10:00:0${generation}.000Z`)
  );

  /** The service manager: kills the running Daemon, then starts another a moment later. */
  const restart = () => {
    log.push("restart");
    current?.kill();
    down = true;

    if (options.comesBack)
      setTimeout(() => {
        generation += 1;
        down = false;
      }, 50);
  };

  return { log, connector, restart };
};

const shellRunnerFor = (
  host: ReturnType<typeof fakeHost>,
  answer: (line: string) => SshResult,
  ran: Array<string>
): RestartRunner => ({
  kind: "shell",
  via: "ssh",
  windows: false,
  exec: (line) =>
    Effect.sync(() => {
      ran.push(line);

      if (line === shScript(SERVICE_PROBE))
        return { code: 0, stdout: "os=Darwin\nuid=501\nlaunchd=gui\n", stderr: "" };
      const result = answer(line);

      if (result.code === 0) host.restart();

      return result;
    }),
});

const ok: SshResult = { code: 0, stdout: "", stderr: "" };

const scenario = <A, E>(
  options: { readonly comesBack?: boolean; readonly up?: boolean },
  body: (
    host: ReturnType<typeof fakeHost>,
    connection: Effect.Success<ReturnType<typeof makeHostConnection>>,
    states: Array<ConnectionState>
  ) => Effect.Effect<A, E, Scope.Scope>
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = fakeHost({ comesBack: options.comesBack ?? true, up: options.up ?? true });

        const connection = yield* makeHostConnection({
          key: "studio",
          name: "Mac Studio",
          target: HostTarget.Ssh({ alias: "studio" }),
          identity: { name: "t", version: "0", deviceLabel: "t", capabilities: ["host.restart"] },
          connector: host.connector,
          policy: { initialDelayMs: 10, maxDelayMs: 20, jitter: 0 },
          rpc: { pingIntervalMs: 60_000 },
        });

        const states: Array<ConnectionState> = [];
        yield* connection.changes.pipe(
          Stream.runForEach((s) =>
            Effect.sync(() => {
              if (states.at(-1) !== s.state) states.push(s.state);
            })
          ),
          Effect.forkScoped
        );

        if (options.up ?? true) yield* connection.awaitSession;

        return yield* body(host, connection, states);
      })
    )
  );

describe("restartDaemon", () => {
  test("Claude's Turns end before the stop; the machine goes Reconnecting, then Connected to a new Daemon", async () => {
    const ran: Array<string> = [];

    const result = await scenario({}, (host, connection, states) =>
      Effect.map(
        restartDaemon({
          name: "Mac Studio",
          local: false,
          connection,
          runner: shellRunnerFor(host, () => ok, ran),
        }),
        (outcome) => ({ outcome, log: host.log, states })
      )
    );

    expect(result.log).toEqual(["prepare", "restart"]);
    expect(ran.at(-1)).toContain("launchctl kickstart -k gui/501/dev.lux.polaris");
    expect(result.outcome).toEqual({
      manager: "launchd",
      command: "launchctl kickstart -k gui/501/dev.lux.polaris",
      previousStartedAt: "2026-10-29T10:00:01.000Z",
      startedAt: "2026-10-29T10:00:02.000Z",
      interruptedTurns: 2,
    });
    expect(result.states).toEqual(["reconnecting", "connected", "reconnecting", "connected"]);
  });

  test("a remote Host that isn't connected is refused, and nothing runs there", async () => {
    const ran: Array<string> = [];

    const exit = await scenario({ up: false }, (host, connection) =>
      Effect.exit(
        restartDaemon({
          name: "Mac Studio",
          local: false,
          connection,
          runner: shellRunnerFor(host, () => ok, ran),
        })
      )
    );

    expect(Exit.isFailure(exit) && String(Exit.findErrorOption(exit))).toContain(
      "Restarts once Mac Studio is connected"
    );
    expect(ran).toEqual([]);
  });

  test("this Mac restarts while its Daemon doesn't answer", async () => {
    const ran: Array<string> = [];

    const result = await scenario({ up: false }, (host, connection) =>
      restartDaemon({
        name: "This Mac",
        local: true,
        connection,
        runner: shellRunnerFor(host, () => ok, ran),
        prepareTimeout: 100,
        retryEvery: 20,
      })
    );

    expect(result.previousStartedAt).toBeNull();
    expect(result.startedAt).toBe("2026-10-29T10:00:01.000Z");
    expect(result.interruptedTurns).toBeNull();
  });

  test("a refusing service manager surfaces its stderr and the exact command", async () => {
    const stderr = 'Could not find service "dev.lux.polaris" in domain for user gui: 501';

    const exit = await scenario({}, (host, connection) =>
      Effect.flip(
        restartDaemon({
          name: "Mac Studio",
          local: false,
          connection,
          runner: shellRunnerFor(host, () => ({ code: 113, stdout: "", stderr }), []),
        })
      )
    );

    expect(exit).toBeInstanceOf(RestartFailed);
    expect(exit).toMatchObject({
      stage: "service",
      manager: "launchd",
      command: "launchctl kickstart -k gui/501/dev.lux.polaris",
      output: stderr,
      exitCode: 113,
      reinstall: true,
    });
  });

  test("a Daemon that never comes back fails with Reinstall service", async () => {
    const exit = await scenario({ comesBack: false }, (host, connection) =>
      Effect.flip(
        restartDaemon({
          name: "Mac Studio",
          local: false,
          connection,
          runner: shellRunnerFor(host, () => ok, []),
          backTimeout: 300,
        })
      )
    );

    expect(exit).toBeInstanceOf(RestartFailed);
    expect(exit).toMatchObject({ stage: "start", reinstall: true });
  });

  test("the channel failing names no command", async () => {
    const exit = await scenario({}, (_host, connection) =>
      Effect.flip(
        restartDaemon({
          name: "Mac Studio",
          local: false,
          connection,
          runner: {
            kind: "shell",
            via: "ssh",
            windows: false,
            exec: () =>
              Effect.fail(
                new SshError({ alias: "studio", failure: "unreachable", message: "no route" })
              ),
          },
        })
      )
    );

    expect(exit).toBeInstanceOf(RestartFailed);
    expect(exit).toMatchObject({ stage: "channel", command: null });
  });

  test("Windows: a sign-in task another Polaris home owns is a TaskConflict", async () => {
    const report = JSON.stringify({
      ok: false,
      error: "TaskConflictError",
      message: "the task runs another home",
      task: "dev.lux.polaris.lucas",
      otherHome: "C:\\other\\.polaris",
    });

    const exit = await scenario({}, (_host, connection) =>
      Effect.flip(
        restartDaemon({
          name: "Studio PC",
          local: false,
          connection,
          runner: {
            kind: "shell",
            via: "ssh",
            windows: true,
            exec: () => Effect.succeed({ code: 3, stdout: report, stderr: "" }),
          },
        })
      )
    );

    expect(exit).toBeInstanceOf(TaskConflict);
    expect(exit).toMatchObject({ otherHome: "C:\\other\\.polaris" });
  });
});
