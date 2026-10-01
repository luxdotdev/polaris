import { join } from "node:path";
import { AttemptId, ConstellationId, SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import { McpBinding } from "./binding.ts";
import { mcpHttp } from "./http.ts";
import { McpTokens } from "./tokens.ts";
import { unavailableCommands } from "./tools.ts";

const home = process.env.POLARIS_HOME;

if (!home) throw new Error("The idle fixture needs a temporary POLARIS_HOME");

const count = Number(process.argv[2] ?? 0);

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const tokens = yield* McpTokens;
      yield* mcpHttp(unavailableCommands);

      for (let i = 0; i < count; i++)
        yield* tokens.issue(
          McpBinding.cases.Worker.make({
            sessionId: SessionId.make(`worker-${i}`),
            constellationId: ConstellationId.make("idle"),
            attemptId: AttemptId.make(`attempt-${i}`),
          })
        );
      Bun.gc(true);
      process.stdout.write("ready\n");
      yield* Effect.never;
    })
  ).pipe(Effect.provide(McpTokens.layer(join(home, "tokens.sqlite"))))
);
