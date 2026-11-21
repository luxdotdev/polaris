import { expect, test } from "bun:test";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { CommandRejected, NotFound, SessionId } from "@polaris/protocol";
import { Effect, Layer, Schema } from "effect";
import { trackClaudeProcess } from "../harness/claude/processIdentity.ts";
import { harnessProcesses } from "../harness/processIdentity.ts";
import { scopedTempDir } from "../platform/tempDir.testing.ts";
import { type Actor, authorize, ConnectionActor, unattributedReason } from "./actor.ts";
import { ServerRpcs } from "./rpcs.ts";
import { startServer } from "./server.ts";

const fixture = join(import.meta.dir, "fixtures", "actorClient.ts");

const temporary = scopedTempDir("pl-actor-", { short: true });

const resultSchema = Schema.fromJsonString(
  Schema.Struct({
    first: Schema.String,
    second: Schema.String,
    action: Schema.String,
    userOnly: Schema.String,
  })
);

const withPid = Schema.is(Schema.Struct({ pid: Schema.Int }));

test.skipIf(process.platform === "win32")(
  "real peer PID follows a fake Claude Harness through a child with no env; shared servers fail closed",
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* temporary;
          let unregister = () => {};

          const handlers = Layer.mergeAll(
            ServerRpcs.toLayerHandler("harness.models", () =>
              Effect.gen(function* () {
                const actor = yield* ConnectionActor;
                unregister();

                return yield* new NotFound({ what: "actor", id: JSON.stringify(actor) });
              })
            ),
            ServerRpcs.toLayerHandler("dispatch", ({ commandId }) =>
              Effect.fail(new CommandRejected({ commandId, reason: "handler reached" }))
            )
          );

          let permitSessionAction = false;

          const server = yield* startServer({
            root,
            socketPath: join(root, "d.sock"),
            lockPath: join(root, "d.lock"),
            handlers,
            authorizeActor: (actor, request) =>
              permitSessionAction
                ? Effect.void
                : authorize(actor, ["read", "comment"], {
                    rpc: request.rpc,
                    command: request.command?._tag ?? null,
                  }),
          });

          for (const shared of [false, true, false]) {
            const options: Options = {};
            const sessionId = SessionId.make("real-session");
            trackClaudeProcess(options, sessionId);

            const child = options.spawnClaudeCodeProcess!({
              command: process.execPath,
              args: [fixture, "harness", server.socketPath],
              cwd: process.cwd(),
              env: { POLARIS_SESSION_ID: "forged", POLARIS_ACTOR: "user" },
              signal: new AbortController().signal,
            });

            if (!withPid(child)) throw new Error("missing child PID");

            expect(harnessProcesses.actorFor(child.pid)).toEqual({
              kind: "agentSession",
              sessionId,
            });

            const expected: Actor = shared
              ? { kind: "agentUnattributed", harnessServer: "Codex" }
              : { kind: "agentSession", sessionId };

            unregister = harnessProcesses.register(child.pid, expected);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                unregister();
                child.kill("SIGKILL");
              })
            );
            child.stdin.end("go");
            const output = yield* Effect.promise(() => new Response(child.stdout).text());
            const result = Schema.decodeUnknownSync(resultSchema)(output.trim());
            expect(JSON.parse(result.first)).toEqual(expected);
            // The first RPC removes the registration; the connection must retain its actor.
            expect(result.second).toBe(result.first);
            expect(result.action).toBe(
              shared ? unattributedReason : permitSessionAction ? "handler reached" : "NotGranted"
            );
            expect(result.userOnly).toBe(
              shared || !permitSessionAction ? "NotGranted" : "UserAccessRequired"
            );
            permitSessionAction = true;
          }

          unregister = () => {};

          const user = Bun.spawn([process.execPath, fixture, "client", server.socketPath], {
            env: { POLARIS_SESSION_ID: "forged" },
            stdout: "pipe",
            stderr: "inherit",
          });

          const output = yield* Effect.promise(() => new Response(user.stdout).text());
          expect(yield* Effect.promise(() => user.exited)).toBe(0);

          const result = Schema.decodeUnknownSync(resultSchema)(output.trim());
          expect(JSON.parse(result.first)).toEqual({ kind: "user" });
          expect(result.action).toBe("UserAccessRequired");
          expect(result.userOnly).toBe("UserAccessRequired");
        })
      )
    ),
  30_000
);
