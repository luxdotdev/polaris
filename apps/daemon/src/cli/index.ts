import { inspect } from "node:util";
import { connectRpcWith, type RpcConnection } from "@polaris/client";
import {
  commands,
  Command,
  CommandId,
  ExtensionDaemonRpcs,
  HostStreamItem,
  SessionStreamItem,
  Unsupported,
  type AnnotatedCommand,
} from "@polaris/protocol";
import { Effect, Exit, Cause, Result, Predicate, Schema, Stream } from "effect";
import type { RpcGroup } from "effect/rpc";

type CommandClient = RpcConnection<RpcGroup.Rpcs<typeof ExtensionDaemonRpcs>>["client"];

import { paths } from "../paths.ts";
import { localDaemonTransport } from "../transport/localDaemon.ts";
import {
  commandFields,
  decodeCommandPayload,
  flagName,
  parseCommandArguments,
  UsageError,
  type CommandValue,
} from "./arguments.ts";

const identity = {
  clientName: "polaris-cli",
  clientVersion: "0.0.0",
  deviceLabel: "polaris CLI",
  capabilities: [],
};

export const commandHelp = (selected: ReadonlyArray<AnnotatedCommand> = commands) =>
  [
    "usage: polaris <noun> <verb> [arguments] [--json]",
    "",
    ...selected.flatMap((command) => {
      const fields = commandFields(command);

      return [
        `${command.name.replace(".", " ")} — ${command.description}`,
        ...Object.keys(fields.properties ?? {}).map(
          (key) =>
            `  --${flagName(key)} <value>${fields.required?.includes(key) && !Object.hasOwn(command.defaults ?? {}, key) && !command.generated?.includes(key) ? " (required)" : ""}`
        ),
        ...command.examples.map((example) => `  ${example}`),
      ];
    }),
    "",
    "Output: human-readable on a terminal; JSON when piped or with --json. Watch emits one JSON value per line.",
    "Use JSON for array/object values, --flag=value, or -- before positional values starting with --.",
    "session start reads its prompt from stdin when omitted. --host <name> is not yet supported.",
    "Exit codes: 0 ok; 1 refused/NotGranted; 2 usage; 3 not found; 4 unreachable.",
    "Existing commands: serve, bridge, install, uninstall, upgrade, version, selftest, lease, constellation, extension, tailscale, voice.",
  ].join("\n");

const projectHost = (command: AnnotatedCommand, value: CommandValue) => {
  const snapshot = Schema.decodeUnknownSync(HostStreamItem.cases.Snapshot)(value);

  switch (command.project) {
    case "sessions":
      return snapshot.sessions;
    case "workspaces":
      return snapshot.workspaces;
    case "approvals":
      return snapshot.sessions.flatMap(({ pendingApprovals }) => pendingApprovals);
    default:
      return snapshot;
  }
};

const invoke = (client: CommandClient, command: AnnotatedCommand, payload: CommandValue) => {
  // SAFETY: the catalogue comes from DaemonRpcs; payload was decoded with that entry's schema.
  const call = client[command.rpcTag as keyof CommandClient] as (
    input: CommandValue
  ) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>;

  const result = call(payload);

  if (command.mode === "snapshot" || command.mode === "watch") {
    // SAFETY: only streaming RPCs carry snapshot/watch annotations, checked in protocol tests.
    return result as Stream.Stream<unknown, unknown>;
  }

  // SAFETY: entries without a streaming mode annotate unary RPCs.
  return result as Effect.Effect<unknown, unknown>;
};

interface CommandReceipt {
  sequence: number | null;
  sessionId?: CommandValue;
}

const execute = (
  client: CommandClient,
  command: AnnotatedCommand,
  payload: CommandValue,
  emit: (value: CommandValue) => void
) =>
  Effect.gen(function* () {
    if (command.dispatchTag !== undefined) {
      const values = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
        payload
      );

      const dispatched = Schema.decodeUnknownSync(Command)({
        ...values,
        _tag: command.dispatchTag,
      });

      const ack = yield* client.dispatch({
        commandId: CommandId.make(crypto.randomUUID()),
        command: dispatched,
      });

      const output: CommandReceipt = {
        sequence: ack.sequence,
      };

      if (command.generated?.includes("sessionId")) output.sessionId = values.sessionId;
      emit(output);

      return;
    }

    if (command.project === "host") {
      emit([(yield* client.hello(identity)).host]);

      return;
    }

    const result = invoke(client, command, payload);

    if (Stream.isStream(result)) {
      const stream = command.mode === "snapshot" ? Stream.take(result, 1) : result;
      yield* Stream.runForEach(stream, (item) =>
        Effect.sync(() =>
          emit(
            command.rpcTag === "subscribeHost"
              ? projectHost(command, item)
              : Schema.decodeUnknownSync(SessionStreamItem)(item)
          )
        )
      );
    } else emit(yield* result);
  });

export interface CommandIO {
  readonly tty: boolean;
  readonly stdinTTY: boolean;
  readonly readStdin: () => Promise<string>;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const defaultIO: CommandIO = {
  tty: !!process.stdout.isTTY,
  stdinTTY: !!process.stdin.isTTY,
  readStdin: () => Bun.stdin.text(),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

const failureCode = (error: CommandValue) => {
  if (Predicate.isTagged(error, "NotFound")) return 3;

  if (Predicate.isTagged(error, "SessionStartUsage")) return 2;

  if (
    Predicate.isTagged(error, "ConnectFailure") ||
    Predicate.isTagged(error, "RpcClientError") ||
    Predicate.isTagged(error, "TimeoutError")
  )
    return 4;

  return 1;
};

export const runCommands = async (
  args: ReadonlyArray<string>,
  io: CommandIO = defaultIO
): Promise<number> => {
  const [noun, verb, ...rest] = args;
  const command = commands.find((command) => command.name === `${noun}.${verb}`);

  const separator = args.indexOf("--");
  const flags = separator < 0 ? args : args.slice(0, separator);

  if (args.length === 0 || flags.includes("--help") || flags.includes("-h")) {
    io.out(
      commandHelp(
        command
          ? [command]
          : commands.filter((c) => !noun || noun.startsWith("-") || c.name.startsWith(`${noun}.`))
      )
    );

    return 0;
  }

  if (flags.some((arg) => arg === "--host" || arg.startsWith("--host="))) {
    io.err("--host is not yet supported; run polaris on that host.");

    return 2;
  }

  if (!command) {
    io.err(`Unknown command: ${args.join(" ")}\nRun polaris --help.`);

    return 2;
  }

  try {
    const { values, json } = parseCommandArguments(command, rest);

    if (command.stdin && values[command.stdin] === undefined && !io.stdinTTY)
      values[command.stdin] = await io.readStdin();

    if (command.name === "session.start") values.cwd = process.cwd();
    const payload = decodeCommandPayload(command, values);

    const emit = (value: CommandValue) =>
      io.out(json || !io.tty ? JSON.stringify(value) : inspect(value, { depth: 8, colors: false }));

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* localDaemonTransport(
            process.env.POLARIS_HOST_SOCKET ?? paths().socket
          );

          const { client } = yield* connectRpcWith(ExtensionDaemonRpcs, transport);
          const hello = yield* client.hello(identity).pipe(Effect.timeout("10 seconds"));

          if (command.rpcTag === "session.start" && !hello.capabilities.includes("session.start"))
            return yield* new Unsupported({ capability: "session.start" });
          const request = execute(client, command, payload, emit);
          yield* command.mode === "watch" ? request : request.pipe(Effect.timeout("30 seconds"));
        })
      )
    );

    if (Exit.isSuccess(result)) return 0;
    const error = Result.getOrUndefined(Cause.findError(result.cause));
    io.err(`polaris ${noun} ${verb}: ${inspect(error ?? result.cause, { depth: 6 })}`);

    return failureCode(error);
  } catch (error) {
    io.err(`polaris ${noun} ${verb}: ${String(error)}`);

    return error instanceof UsageError ? 2 : 1;
  }
};
