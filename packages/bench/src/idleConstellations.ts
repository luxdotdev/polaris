import { join } from "node:path";
import { Effect } from "effect";
import { REPO_ROOT } from "./daemon.ts";

/** The fixture writer runs only between Daemons and uses the benchmark's temporary home. */
export const seedIdleGraphs = Effect.fnUntraced(function* (home: string) {
  const process = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(
        ["bun", join(REPO_ROOT, "apps/daemon/src/engine/constellation.benchmark.ts"), home],
        { stdout: "pipe", stderr: "pipe" }
      )
    ),
    (child) => Effect.sync(() => child.kill())
  );

  const output = yield* Effect.promise(() => new Response(process.stdout).text());
  const error = yield* Effect.promise(() => new Response(process.stderr).text());

  if ((yield* Effect.promise(() => process.exited)) !== 0)
    throw new Error(`idle constellation fixture: ${error}`);

  return Number.parseInt(output.trim(), 10);
});
