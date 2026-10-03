import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { connectRpc, socketTransport } from "@polaris/client";
import { DomainEvent, SessionStreamItem, type Attempt } from "@polaris/protocol";
import { Effect, Option, Stream } from "effect";
import { HOST } from "../engine/constellation.testing.ts";

/** Boot the production Daemon on the pending retry, using only the scripted Harness. */
export const restartForRetry = async (root: string, attempt: Attempt) => {
  writeFileSync(join(root, "host-id"), `${HOST}\n`);

  const socket = join(root, "daemon.sock");

  const daemon = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, "../main.ts"), "serve", "--foreground"],
    {
      env: {
        ...process.env,
        POLARIS_HOME: root,
        POLARIS_HOST_SOCKET: socket,
        POLARIS_BENCH_HARNESS: "1",
        POLARIS_SESSION_ID: undefined,
        POLARIS_BINARY: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  try {
    const reader = daemon.stdout.getReader();
    let logs = "";

    while (!logs.includes("Daemon listening on")) {
      const chunk = await reader.read();

      if (chunk.done)
        throw new Error(`Daemon stopped: ${logs}\n${await new Response(daemon.stderr).text()}`);
      logs += new TextDecoder().decode(chunk.value);
    }

    reader.releaseLock();

    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* socketTransport(socket);
          const { client } = yield* connectRpc(transport);

          yield* client.hello({
            clientName: "sendback-test",
            clientVersion: "0",
            deviceLabel: "test",
            capabilities: ["constellation"],
          });

          const found = yield* client
            .subscribeSession({
              sessionId: attempt.sessionId,
              afterSequence: null,
              turnLimit: null,
            })
            .pipe(
              Stream.map((item) => {
                if (SessionStreamItem.guards.Snapshot(item))
                  return item.turns.find((t) => t.turn.id === `${attempt.id}:start`)?.turn;

                if (
                  SessionStreamItem.guards.Event(item) &&
                  DomainEvent.guards.TurnStarted(item.envelope.event)
                )
                  return item.envelope.event.turn;

                return undefined;
              }),
              Stream.filter((turn) => turn !== undefined && turn.id === `${attempt.id}:start`),
              Stream.runHead
            );

          return Option.getOrThrow(found)!;
        })
      ).pipe(Effect.timeout(10000))
    );
  } finally {
    daemon.kill("SIGTERM");
    await daemon.exited;
  }
};
