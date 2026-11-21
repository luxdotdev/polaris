import { spawn } from "node:child_process";
import { connectRpcWith, socketTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  ExtensionDaemonRpcs,
  SessionId,
  SessionPlacement,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";

const [mode, socketPath = "", workspaceId = ""] = process.argv.slice(2);

if (mode === "harness") {
  await Bun.stdin.text();

  const child = spawn(process.execPath, [import.meta.filename, "client", socketPath, workspaceId], {
    env: {},
    stdio: ["ignore", "inherit", "inherit"],
  });

  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
} else {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connectRpcWith(
          ExtensionDaemonRpcs,
          yield* socketTransport(socketPath)
        );

        yield* client.hello({
          clientName: "session-cli",
          clientVersion: "0",
          deviceLabel: "CLI",
          capabilities: [],
        });
        yield* client.dispatch({
          commandId: CommandId.make("cli-start"),
          command: Command.cases.StartSession.make({
            sessionId: SessionId.make("from-cli"),
            workspaceId: WorkspaceId.make(workspaceId),
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Continue here",
            attachments: [],
          }),
        });
        console.log("started");
      })
    )
  );
}
