import { spawn } from "node:child_process";
import { connectRpcWith, socketTransport } from "@polaris/client";
import { Command, CommandId, SessionId, ExtensionDaemonRpcs, RequestId } from "@polaris/protocol";
import { Effect, Redacted } from "effect";

const [mode, socketPath = ""] = process.argv.slice(2);

if (mode === "harness") {
  await Bun.stdin.text();

  const child = spawn(process.execPath, [import.meta.filename, "client", socketPath], {
    env: {},
    stdio: ["ignore", "inherit", "inherit"],
  });

  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
} else {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connectRpcWith(
          ExtensionDaemonRpcs,
          yield* socketTransport(socketPath)
        );

        yield* connection.client.hello({
          clientName: "identity-test",
          clientVersion: "0",
          deviceLabel: "fake",
          capabilities: [],
        });

        const readActor = () =>
          connection.client["harness.models"]({ harness: "claude", refresh: false }).pipe(
            Effect.catchTag("NotFound", (error) => Effect.succeed(error.id))
          );

        const first = yield* readActor();
        const second = yield* readActor();

        const action = yield* connection.client
          .dispatch({
            commandId: CommandId.make("interrupt"),
            command: Command.cases.Interrupt.make({ sessionId: SessionId.make("target") }),
          })
          .pipe(
            Effect.as("handler reached"),
            Effect.catchTag("NotGranted", (error) => Effect.succeed(error.reason ?? "NotGranted")),
            Effect.catchTag("UserAccessRequired", () => Effect.succeed("UserAccessRequired")),
            Effect.catchTag("CommandRejected", () => Effect.succeed("handler reached"))
          );

        const userOnly = yield* connection.client["secret.provide"]({
          sessionId: SessionId.make("target"),
          requestId: RequestId.make("r1"),
          value: Redacted.make("fixture"),
        }).pipe(
          Effect.as("handler reached"),
          Effect.catchTag("NotGranted", () => Effect.succeed("NotGranted")),
          Effect.catchTag("UserAccessRequired", () => Effect.succeed("UserAccessRequired"))
        );

        console.log(JSON.stringify({ first, second, action, userOnly }));
      })
    )
  );
}
