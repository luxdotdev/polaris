import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HostLanguageInstallation } from "../availability/service.ts";

/** The managed private Node (ADR 0019) that Workspace Node tools run on; never Node from PATH. */
export class PrivateNodeRuntime extends Context.Service<
  PrivateNodeRuntime,
  { node: () => Promise<string | null> }
>()("polaris/languages/PrivateNodeRuntime") {
  /** The installed `node` tool's `bin/node`; null until it's downloaded. */
  static readonly layer = Layer.effect(
    PrivateNodeRuntime,
    Effect.gen(function* () {
      const installation = yield* HostLanguageInstallation;

      return PrivateNodeRuntime.of({
        node: async () => {
          const installed = await Effect.runPromise(
            installation.current("node").pipe(Effect.orElseSucceed(() => null))
          );

          return installed === null ? null : join(installed.directory, "bin/node");
        },
      });
    })
  );
}
