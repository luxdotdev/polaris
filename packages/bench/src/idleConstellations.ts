import { join } from "node:path";
import { Effect } from "effect";
import { REPO_ROOT } from "./daemon.ts";

/** Runs a Daemon-side fixture script on the benchmark's temporary home; prints a count. */
const runFixture = Effect.fnUntraced(function* (script: string, home: string) {
  const process = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(["bun", join(REPO_ROOT, script), home], { stdout: "pipe", stderr: "pipe" })
    ),
    (child) => Effect.sync(() => child.kill())
  );

  const output = yield* Effect.promise(() => new Response(process.stdout).text());
  const error = yield* Effect.promise(() => new Response(process.stderr).text());

  if ((yield* Effect.promise(() => process.exited)) !== 0)
    throw new Error(`idle fixture ${script}: ${error}`);

  return Number.parseInt(output.trim(), 10);
});

/** The fixture writer runs only between Daemons and uses the benchmark's temporary home. */
export const seedIdleGraphs = (home: string) =>
  runFixture("apps/daemon/src/engine/constellation.benchmark.ts", home);

/** One Linked Device with a Live Activity registered (ADR 0088). */
export const seedIdleLiveActivity = (home: string) =>
  runFixture("apps/daemon/src/push/live.benchmark.ts", home);
